package com.inventoryborrowingsystem.ui.navigation

import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.inventoryborrowingsystem.ui.screens.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import com.inventoryborrowingsystem.viewmodel.AuthPhase

@Composable
fun AppNavigation(viewModel: AppViewModel) {
    val phase by viewModel.phase.collectAsState()
    val appLocked by viewModel.appLocked.collectAsState()
    val needsPasswordChange by viewModel.needsPasswordChange.collectAsState()
    val showBiometricEnrollment by viewModel.showBiometricEnrollment.collectAsState()
    val firstNodeChosen by viewModel.firstNodeChosen.collectAsState()

    when (phase) {
        AuthPhase.CHECKING -> {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        }
        AuthPhase.SIGNED_OUT -> {
            when (firstNodeChosen) {
                null -> Box(
                    modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }
                false -> ServerSelectScreen(viewModel = viewModel)
                true -> LoginScreen(viewModel = viewModel)
            }
        }
        AuthPhase.SIGNED_IN -> {
            Box(modifier = Modifier.fillMaxSize()) {
                MainScreen(appViewModel = viewModel)

                // App lock overlay
                if (appLocked) {
                    AppLockOverlay(viewModel = viewModel)
                }

                // Password change overlay
                if (needsPasswordChange) {
                    ChangePasswordSheetDialog(
                        viewModel = viewModel,
                        required = true,
                        onDismiss = { /* required = true means can't dismiss */ }
                    )
                }

                // Biometric enrollment prompt
                if (showBiometricEnrollment) {
                    BiometricEnrollmentDialog(viewModel = viewModel)
                }
            }
        }
    }
}

@Composable
private fun AppLockOverlay(viewModel: AppViewModel) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier.padding(32.dp)
        ) {
            Icon(
                Icons.Default.Lock,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                "Inventory",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold)
            )
            Text(
                "App is locked",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Button(
                onClick = { activity?.let { viewModel.unlockApp(it) } },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Unlock with Biometric")
            }
        }
    }
}

@Composable
private fun BiometricEnrollmentDialog(viewModel: AppViewModel) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity

    AlertDialog(
        onDismissRequest = { viewModel.skipBiometricEnrollment() },
        title = { Text("Enable Biometric Login?") },
        text = { Text("Use your fingerprint or face to log in faster next time.") },
        confirmButton = {
            Button(onClick = {
                activity?.let { viewModel.enrollBiometric(it) }
                viewModel.dismissBiometricEnrollment()
            }) { Text("Enable") }
        },
        dismissButton = {
            TextButton(onClick = { viewModel.skipBiometricEnrollment() }) { Text("Skip") }
        }
    )
}
