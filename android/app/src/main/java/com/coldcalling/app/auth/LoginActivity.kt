package com.coldcalling.app.auth

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.coldcalling.app.MainActivity
import com.coldcalling.app.databinding.ActivityLoginBinding
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Check if already authenticated
        if (AuthManager.isLoggedIn(this)) {
            navigateToMain()
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Pre-fill server URL
        binding.etServerUrl.setText(AuthManager.getServerUrl(this))

        binding.btnLogin.setOnClickListener {
            attemptLogin()
        }
    }

    private fun attemptLogin() {
        val serverUrl = binding.etServerUrl.text.toString().trim()
        val email = binding.etEmail.text.toString().trim()
        val password = binding.etPassword.text.toString().trim()

        binding.tvError.visibility = View.GONE

        if (serverUrl.isEmpty()) {
            showError("Please enter the CRM Server URL")
            return
        }
        if (email.isEmpty()) {
            showError("Please enter your CRM email")
            return
        }
        if (password.isEmpty()) {
            showError("Please enter your password")
            return
        }

        setLoading(true)

        lifecycleScope.launch {
            val result = AuthManager.login(
                context = this@LoginActivity,
                emailInput = email,
                passwordInput = password,
                serverUrlInput = serverUrl
            )

            setLoading(false)

            if (result.isSuccess) {
                val user = result.getOrNull()
                Toast.makeText(
                    this@LoginActivity,
                    "Welcome, ${user?.name ?: "Agent"}! Signed in as ${user?.role ?: "member"}.",
                    Toast.LENGTH_LONG
                ).show()
                navigateToMain()
            } else {
                val err = result.exceptionOrNull()?.message ?: "Sign-in failed. Please check network and credentials."
                showError(err)
            }
        }
    }

    private fun showError(message: String) {
        binding.tvError.text = message
        binding.tvError.visibility = View.VISIBLE
    }

    private fun setLoading(loading: Boolean) {
        binding.btnLogin.isEnabled = !loading
        binding.btnLogin.text = if (loading) "Connecting to CRM..." else "Sign In to CRM"
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.etServerUrl.isEnabled = !loading
        binding.etEmail.isEnabled = !loading
        binding.etPassword.isEnabled = !loading
    }

    private fun navigateToMain() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        startActivity(intent)
        finish()
    }
}
