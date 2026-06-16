package com.inventoryborrowingsystem.ui.components

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import com.inventoryborrowingsystem.viewmodel.AppViewModel

/**
 * "Please enable location" nudge, shown on each launch/foreground while permission
 * isn't granted. Rendered as a dialog so it sits above the app-lock overlay. The
 * primary button triggers the OS permission dialog (or, if permanently denied,
 * the user can open system Settings). Dismissing skips it for this launch.
 */
@Composable
fun GeoConsentGate(viewModel: AppViewModel) {
    val context = LocalContext.current
    val nudge by viewModel.showLocationNudge.collectAsState()
    val firstNodeChosen by viewModel.firstNodeChosen.collectAsState()
    // Don't cover the first-launch server-selection screen with the location
    // nudge — it would block taps on the node list.
    val show = nudge && (firstNodeChosen != false)

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        viewModel.onLocationPermissionResult()
    }

    if (show) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissLocationNudge() },
            title = { Text("Enable Location") },
            text = {
                Text(
                    "Please allow location access. It lets the app pick the closest, " +
                        "fastest server, keeps you compliant with regional access rules, and " +
                        "records where each operation happens for security auditing. Your " +
                        "location is only used for these purposes."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    permissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        )
                    )
                }) { Text("Allow Location") }
            },
            dismissButton = {
                TextButton(onClick = {
                    val intent = Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", context.packageName, null)
                    )
                    context.startActivity(intent)
                    viewModel.dismissLocationNudge()
                }) { Text("Open Settings") }
            }
        )
    }
}
