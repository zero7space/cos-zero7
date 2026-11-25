package com.coldcalling.app.recording.wireless;

import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.zip.CRC32;

import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509KeyManager;
import javax.net.ssl.X509TrustManager;

/**
 * ADB client supporting Android 11+ Wireless Debugging STLS upgrade protocol.
 * Connects to localhost wireless debugging port and executes shell commands under UID 2000.
 */
public class AdbClient {
    private static final String TAG = "AdbClient";
    private static final int AUTH_TOKEN = 1;
    private static final int AUTH_SIGNATURE = 2;
    private static final int AUTH_RSAPUBLICKEY = 3;
    private static final int AUTH_OK = 0;
    private static final byte[] SHA1_DIGESTINFO_PREFIX = {
            0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14
    };

    private Socket socket;
    private DataInputStream in;
    private OutputStream out;

    public boolean tls = false;

    private PrivateKey clientKey;
    private String clientCertPem;

    public void setClientCert(PrivateKey key, String certPem) {
        clientKey = key;
        clientCertPem = certPem;
    }

    public static PrivateKey loadKey(String pem) throws Exception {
        String body = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der2 = Base64.decode(body, Base64.DEFAULT);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der2));
    }

    public boolean connect(String host, int port, PrivateKey key) throws Exception {
        try {
            byte[] cnxnPayload = ("host::features=shell_v2,cmd,stat_v2,ls_v2,fixed_push_mkdir,apex,abb,"
                    + "fixed_push_symlink_timestamp,abb_exec,split_bulk,ls_v2,apex").getBytes(StandardCharsets.UTF_8);
            socket = new Socket();
            socket.connect(new InetSocketAddress(host, port), 4000);
            socket.setSoTimeout(30000);

            in = new DataInputStream(socket.getInputStream());
            out = socket.getOutputStream();

            writePacket("CNXN", 0x01000001, 0x00100000, cnxnPayload);
            while (true) {
                Packet p = readPacket();
                if ("CNXN".equals(p.command)) return true;
                if ("AUTH".equals(p.command)) return authLoop(key, p);
                if ("STLS".equals(p.command)) {
                    writePacket("STLS", p.arg0, 0, null);
                    upgradeTls(host, port);
                    while (true) {
                        Packet p2 = readPacket();
                        if ("CNXN".equals(p2.command)) return true;
                        if ("AUTH".equals(p2.command)) return authLoop(key, p2);
                    }
                }
            }
        } catch (Exception e) {
            close();
            throw e;
        }
    }

    private void upgradeTls(String host, int port) throws Exception {
        SSLContext sc = SSLContext.getInstance("TLS");
        sc.init(buildKeyManagers(), new TrustManager[]{new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] c, String a) {}
            public void checkServerTrusted(X509Certificate[] c, String a) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }}, new SecureRandom());
        SSLSocket tlsSock = (SSLSocket) sc.getSocketFactory().createSocket(socket, host, port, true);
        tlsSock.setUseClientMode(true);
        tlsSock.setSoTimeout(30000);
        tlsSock.startHandshake();
        in = new DataInputStream(tlsSock.getInputStream());
        out = tlsSock.getOutputStream();
        socket = tlsSock;
    }

    private boolean authLoop(PrivateKey key, Packet first) throws Exception {
        Packet p = first;
        int authTries = 0;
        while (authTries++ < 4) {
            if (p.command.equals("CNXN")) return true;
            if (p.command.equals("AUTH")) {
                if (p.arg0 == AUTH_TOKEN && p.data != null && p.data.length > 0) {
                    Signature sig = Signature.getInstance("NONEwithRSA");
                    sig.initSign(key);
                    byte[] di = new byte[SHA1_DIGESTINFO_PREFIX.length + p.data.length];
                    System.arraycopy(SHA1_DIGESTINFO_PREFIX, 0, di, 0, SHA1_DIGESTINFO_PREFIX.length);
                    System.arraycopy(p.data, 0, di, SHA1_DIGESTINFO_PREFIX.length, p.data.length);
                    sig.update(di);
                    writePacket("AUTH", AUTH_SIGNATURE, 0, sig.sign());
                } else if (p.arg0 == AUTH_OK) {
                    return true;
                } else if (p.arg0 == AUTH_RSAPUBLICKEY) {
                    throw new IllegalStateException("adb key not authorized on device");
                }
            }
            p = readPacket();
        }
        throw new IllegalStateException("adb auth failed: key not accepted");
    }

    private KeyManager[] buildKeyManagers() throws Exception {
        if (clientKey == null || clientCertPem == null) return null;
        final java.security.cert.CertificateFactory cf = java.security.cert.CertificateFactory.getInstance("X.509");
        final X509Certificate cert = (X509Certificate) cf.generateCertificate(
                new java.io.ByteArrayInputStream(clientCertPem.getBytes(StandardCharsets.UTF_8)));
        final X509Certificate[] chain = new X509Certificate[]{cert};
        final PrivateKey key = clientKey;
        return new KeyManager[]{new X509KeyManager() {
            public String chooseClientAlias(String[] keyType, java.security.Principal[] issuers, Socket socket) { return "adbkey"; }
            public String chooseServerAlias(String keyType, java.security.Principal[] issuers, Socket socket) { return null; }
            public X509Certificate[] getCertificateChain(String alias) { return "adbkey".equals(alias) ? chain : null; }
            public PrivateKey getPrivateKey(String alias) { return "adbkey".equals(alias) ? key : null; }
            public String[] getClientAliases(String keyType, java.security.Principal[] issuers) { return new String[]{"adbkey"}; }
            public String[] getServerAliases(String keyType, java.security.Principal[] issuers) { return null; }
        }};
    }

    public String shell(String cmd) throws Exception {
        byte[] openData = ("shell:" + cmd + "\u0000").getBytes(StandardCharsets.UTF_8);
        Log.d(TAG, "Sending OPEN: shell:" + cmd);
        writePacket("OPEN", 1, 0, openData);
        long localId = 0, remoteId = 0;
        StringBuilder sb = new StringBuilder();
        boolean closed = false;
        int guard = 0;
        while (!closed && guard++ < 2000) {
            Packet p = readPacket();
            Log.d(TAG, "shell RX: cmd=" + p.command + " arg0=" + p.arg0 + " arg1=" + p.arg1 + " len=" + (p.data != null ? p.data.length : 0));
            if (p.command.equals("OKAY")) {
                if (localId == 0) { localId = p.arg1; remoteId = p.arg0; }
            } else if (p.command.equals("WRTE")) {
                if (p.data != null) {
                    String chunk = new String(p.data, StandardCharsets.UTF_8);
                    Log.d(TAG, "shell WRTE data: " + chunk);
                    sb.append(chunk);
                }
                writePacket("OKAY", p.arg1, p.arg0, null);
            } else if (p.command.equals("CLSE")) {
                writePacket("CLSE", p.arg1, p.arg0, null);
                closed = true;
                break;
            }
        }
        return sb.toString();
    }

    public void close() {
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        socket = null;
    }

    private static class Packet {
        String command;
        int arg0, arg1;
        byte[] data;
    }

    private Packet readPacket() throws Exception {
        byte[] hdr = readFully(24);
        if (hdr == null) throw new EOFException("connection closed");
        String cmd = new String(hdr, 0, 4, StandardCharsets.US_ASCII);
        int arg0 = leInt(hdr, 4), arg1 = leInt(hdr, 8), len = leInt(hdr, 12);
        byte[] data = len > 0 ? readFully(len) : null;
        Packet p = new Packet();
        p.command = cmd; p.arg0 = arg0; p.arg1 = arg1; p.data = data;
        return p;
    }

    private void writePacket(String cmd, int arg0, int arg1, byte[] data) throws Exception {
        int len = data != null ? data.length : 0;
        byte[] cbytes = cmd.getBytes(StandardCharsets.US_ASCII);
        int cmdInt = (cbytes[0] & 0xff) | ((cbytes[1] & 0xff) << 8) | ((cbytes[2] & 0xff) << 16) | ((cbytes[3] & 0xff) << 24);
        int sum = 0;
        if (data != null) {
            for (byte b : data) sum += (b & 0xff);
        }
        byte[] hdr = new byte[24];
        System.arraycopy(cbytes, 0, hdr, 0, 4);
        putLeInt(hdr, 4, arg0); putLeInt(hdr, 8, arg1); putLeInt(hdr, 12, len); putLeInt(hdr, 16, sum);
        putLeInt(hdr, 20, cmdInt ^ 0xffffffff);
        out.write(hdr);
        if (data != null) out.write(data);
        out.flush();
    }

    private byte[] readFully(int n) throws Exception {
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r < 0) return off == 0 ? null : buf;
            off += r;
        }
        return buf;
    }

    private static int leInt(byte[] b, int off) {
        return (b[off] & 0xff) | ((b[off + 1] & 0xff) << 8) | ((b[off + 2] & 0xff) << 16) | ((b[off + 3] & 0xff) << 24);
    }

    private static void putLeInt(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
        b[off + 2] = (byte) ((v >> 16) & 0xff);
        b[off + 3] = (byte) ((v >> 24) & 0xff);
    }
}
