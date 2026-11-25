package com.coldcalling.app.recording.wireless;

import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import org.conscrypt.Conscrypt;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509KeyManager;
import javax.net.ssl.X509TrustManager;

/**
 * Android 11+ Wireless Debugging Pairing Client.
 * Implements RFC 5705 key material export + SPAKE2 + AES-128-GCM authentication.
 */
public class AdbPairClient {
    private static final String TAG = "AdbPairClient";
    private static final byte TYPE_SPAKE2_MSG = 0;
    private static final byte TYPE_PEER_INFO = 1;
    private static final int PEER_INFO_SIZE = 8192;
    private static final byte TYPE_ADB_RSA_PUB_KEY = 0;
    private static final byte TYPE_ADB_DEVICE_GUID = 1;
    private static final int EXPORTED_KEY_SIZE = 64;
    private static final String EXPORTED_KEY_LABEL = "adb-label\u0000";

    public static class Result {
        public final boolean ok;
        public final String message;
        public Result(boolean ok, String message) { this.ok = ok; this.message = message; }
    }

    public static Result pair(String host, int pairPort, String code, PrivateKey key, String certPem) {
        java.util.List<String> hosts = new java.util.ArrayList<>();
        if (host != null && !host.trim().isEmpty()) hosts.add(host);
        if (!hosts.contains("127.0.0.1")) hosts.add("127.0.0.1");
        if (!hosts.contains("::1")) hosts.add("::1");
        Result last = null;
        for (String h : hosts) {
            last = pairOnce(h, pairPort, code, key, certPem);
            if (last.ok) return last;
        }
        return last != null ? last : new Result(false, "Pairing failed: no route to host");
    }

    private static Result pairOnce(String host, int pairPort, String code, PrivateKey key, String certPem) {
        try {
            String codeTrim = code == null ? "" : code.trim();
            if (codeTrim.length() != 6) return new Result(false, "Please enter a 6-digit pairing code");
            byte[] codeBytes = codeTrim.getBytes(StandardCharsets.US_ASCII);

            if (key == null || certPem == null || certPem.isEmpty()) {
                return new Result(false, "Built-in ADB key/cert missing");
            }

            // 1) TLS connection to pairing port (with client cert)
            Socket raw = new Socket();
            raw.connect(new InetSocketAddress(host, pairPort), 4000);
            raw.setSoTimeout(10000);

            SSLContext sc = SSLContext.getInstance("TLS", Conscrypt.newProvider());
            sc.init(buildKeyManagers(key, certPem), new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] c, String a) {}
                public void checkServerTrusted(X509Certificate[] c, String a) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }}, new SecureRandom());

            SSLSocket sock = (SSLSocket) sc.getSocketFactory().createSocket(raw, host, pairPort, true);
            sock.setUseClientMode(true);
            sock.setEnabledProtocols(new String[]{"TLSv1.3"});
            sock.setSoTimeout(10000);

            try {
                sock.startHandshake();
            } catch (Throwable t) {
                sock.close();
                return new Result(false, "TLS handshake failed: " + shortMsg(t));
            }

            DataInputStream in = new DataInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();

            // 2) Export keying material via Conscrypt
            byte[] exported;
            try {
                exported = Conscrypt.exportKeyingMaterial(sock, EXPORTED_KEY_LABEL, null, EXPORTED_KEY_SIZE);
            } catch (Throwable t) {
                sock.close();
                return new Result(false, "TLS export keying material failed: " + shortMsg(t));
            }

            if (exported == null || exported.length != EXPORTED_KEY_SIZE) {
                sock.close();
                return new Result(false, "Invalid exported keying material length");
            }

            // 3) SPAKE2 (password = 6-digit code + exported key)
            byte[] pswd = new byte[codeBytes.length + exported.length];
            System.arraycopy(codeBytes, 0, pswd, 0, codeBytes.length);
            System.arraycopy(exported, 0, pswd, codeBytes.length, exported.length);

            Spake2 spake = Spake2.newClient();
            byte[] myMsg = spake.generateMsg(pswd);

            // 4) Write SPAKE2_MSG
            writeFrame(out, TYPE_SPAKE2_MSG, myMsg);

            // 5) Read peer SPAKE2_MSG
            byte[] theirMsg = readFrame(in);
            if (theirMsg == null) { sock.close(); return new Result(false, "Pairing timed out: no response from server"); }
            byte[] keyMaterial;
            try {
                keyMaterial = spake.processMsg(theirMsg, 64);
            } catch (Throwable t) {
                sock.close();
                return new Result(false, "SPAKE2 verification failed (code expired or incorrect): " + shortMsg(t));
            }

            // 6) AES-128-GCM: HKDF-SHA256 derived key
            byte[] aesKey = hkdfSha256(keyMaterial, "adb pairing_auth aes-128-gcm key".getBytes(StandardCharsets.US_ASCII), 16);
            AesGcmBox enc = new AesGcmBox(aesKey);
            AesGcmBox dec = new AesGcmBox(aesKey);

            // 7) Encrypt PeerInfo (type=0 + ssh-rsa public key)
            byte[] peerInfo = new byte[PEER_INFO_SIZE];
            peerInfo[0] = TYPE_ADB_RSA_PUB_KEY;
            java.security.cert.CertificateFactory cf = java.security.cert.CertificateFactory.getInstance("X.509");
            X509Certificate certObj = (X509Certificate) cf.generateCertificate(
                    new java.io.ByteArrayInputStream(certPem.getBytes(StandardCharsets.UTF_8)));
            byte[] pubLine = sshRsaPublicKeyLine((java.security.interfaces.RSAPublicKey) certObj.getPublicKey());
            System.arraycopy(pubLine, 0, peerInfo, 1, Math.min(pubLine.length, PEER_INFO_SIZE - 2));
            byte[] encrypted = enc.encrypt(peerInfo);
            writeFrame(out, TYPE_PEER_INFO, encrypted);

            // 8) Read peer PEER_INFO
            byte[] theirEnc = readFrame(in);
            if (theirEnc == null) { sock.close(); return new Result(false, "Pairing timed out: no confirmation received"); }
            byte[] theirInfo;
            try {
                theirInfo = dec.decrypt(theirEnc);
            } catch (Throwable t) {
                sock.close();
                return new Result(false, "Pairing failed: incorrect or expired code");
            }
            sock.close();

            if (theirInfo == null || theirInfo.length == 0 || theirInfo[0] != TYPE_ADB_DEVICE_GUID) {
                return new Result(false, "Pairing failed: invalid device response");
            }

            Log.i(TAG, "Pairing successful!");
            return new Result(true, "Paired successfully with device!");
        } catch (Throwable t) {
            Log.e(TAG, "pair failed", t);
            return new Result(false, "Pairing error: " + shortMsg(t));
        }
    }

    private static String shortMsg(Throwable t) {
        String m = t.getMessage();
        return m != null && !m.isEmpty() ? m : t.getClass().getSimpleName();
    }

    private static KeyManager[] buildKeyManagers(final PrivateKey key, final String certPem) throws Exception {
        final java.security.cert.CertificateFactory cf = java.security.cert.CertificateFactory.getInstance("X.509");
        final X509Certificate cert = (X509Certificate) cf.generateCertificate(
                new java.io.ByteArrayInputStream(certPem.getBytes(StandardCharsets.UTF_8)));
        final X509Certificate[] chain = new X509Certificate[]{cert};
        return new KeyManager[]{new X509KeyManager() {
            public String chooseClientAlias(String[] keyType, java.security.Principal[] issuers, Socket socket) { return "adbkey"; }
            public String chooseServerAlias(String keyType, java.security.Principal[] issuers, Socket socket) { return null; }
            public X509Certificate[] getCertificateChain(String alias) { return "adbkey".equals(alias) ? chain : null; }
            public PrivateKey getPrivateKey(String alias) { return "adbkey".equals(alias) ? key : null; }
            public String[] getClientAliases(String keyType, java.security.Principal[] issuers) { return new String[]{"adbkey"}; }
            public String[] getServerAliases(String keyType, java.security.Principal[] issuers) { return null; }
        }};
    }

    private static void writeFrame(OutputStream out, byte type, byte[] payload) throws Exception {
        byte[] hdr = new byte[6];
        hdr[0] = 1;
        hdr[1] = type;
        int len = payload.length;
        hdr[2] = (byte) (len >>> 24);
        hdr[3] = (byte) (len >>> 16);
        hdr[4] = (byte) (len >>> 8);
        hdr[5] = (byte) len;
        out.write(hdr);
        out.write(payload);
        out.flush();
    }

    private static byte[] readFrame(DataInputStream in) throws Exception {
        byte[] hdr = new byte[6];
        int off = 0;
        while (off < 6) {
            int r = in.read(hdr, off, 6 - off);
            if (r < 0) return null;
            off += r;
        }
        if (hdr[0] != 1) return null;
        long len = ((hdr[2] & 0xffL) << 24) | ((hdr[3] & 0xffL) << 16) | ((hdr[4] & 0xffL) << 8) | (hdr[5] & 0xffL);
        if (len <= 0 || len > 2 * PEER_INFO_SIZE) return null;
        byte[] payload = new byte[(int) len];
        off = 0;
        while (off < len) {
            int r = in.read(payload, off, (int) len - off);
            if (r < 0) return null;
            off += r;
        }
        return payload;
    }

    private static class AesGcmBox {
        private final byte[] key;
        private long encSeq = 0;
        private long decSeq = 0;
        AesGcmBox(byte[] key) { this.key = key; }

        byte[] encrypt(byte[] data) throws Exception {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce(encSeq++)));
            return c.doFinal(data);
        }

        byte[] decrypt(byte[] data) throws Exception {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce(decSeq++)));
            return c.doFinal(data);
        }

        private byte[] nonce(long seq) {
            byte[] n = new byte[12];
            for (int i = 0; i < 8; i++) n[i] = (byte) (seq >>> (8 * i));
            return n;
        }
    }

    static byte[] hkdfSha256(byte[] ikm, byte[] info, int outLen) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(new byte[32], "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 0x01);
        byte[] okm = mac.doFinal();
        return Arrays.copyOf(okm, outLen);
    }

    static byte[] sshRsaPublicKeyLine(java.security.interfaces.RSAPublicKey rsa) throws Exception {
        byte[] androidKey = androidPubkeyBytes(rsa.getModulus(), rsa.getPublicExponent());
        String line = Base64.encodeToString(androidKey, Base64.NO_WRAP) + " ColdCallingPro@LocalHost";
        return line.getBytes(StandardCharsets.US_ASCII);
    }

    static byte[] androidPubkeyBytes(java.math.BigInteger n, java.math.BigInteger e) throws Exception {
        final int MOD = 256;
        ByteArrayOutputStream b = new ByteArrayOutputStream(4 + 4 + MOD + MOD + 4);
        writeLeU32(b, 64);
        long n0 = n.mod(java.math.BigInteger.ONE.shiftLeft(32)).longValue() & 0xFFFFFFFFL;
        long inv = java.math.BigInteger.valueOf(n0).modInverse(java.math.BigInteger.ONE.shiftLeft(32)).longValue() & 0xFFFFFFFFL;
        writeLeU32(b, (0x100000000L - inv) & 0xFFFFFFFFL);
        writeLePadded(b, stripLeadingZero(n.toByteArray()), MOD);
        writeLePadded(b, stripLeadingZero(java.math.BigInteger.ONE.shiftLeft(4096).mod(n).toByteArray()), MOD);
        writeLeU32(b, e.longValue() & 0xFFFFFFFFL);
        return b.toByteArray();
    }

    private static void writeLePadded(ByteArrayOutputStream b, byte[] bigEndian, int size) {
        for (int i = 0; i < size; i++) {
            int src = bigEndian.length - 1 - i;
            b.write(src >= 0 ? (bigEndian[src] & 0xff) : 0);
        }
    }

    private static void writeLeU32(ByteArrayOutputStream b, long v) {
        b.write((int) (v & 0xff));
        b.write((int) ((v >> 8) & 0xff));
        b.write((int) ((v >> 16) & 0xff));
        b.write((int) ((v >> 24) & 0xff));
    }

    private static byte[] stripLeadingZero(byte[] in) {
        int off = 0;
        while (off < in.length - 1 && in[off] == 0) off++;
        if (off == 0) return in;
        byte[] out = new byte[in.length - off];
        System.arraycopy(in, off, out, 0, out.length);
        return out;
    }
}
