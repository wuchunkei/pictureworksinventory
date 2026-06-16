package com.inventoryborrowingsystem.ui.screens

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.AppLockDelay
import com.inventoryborrowingsystem.data.LanguageOption
import com.inventoryborrowingsystem.data.ThemeOption
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeScreen(viewModel: AppViewModel, navController: NavController) {
    val currentUser by viewModel.currentUser.collectAsState()
    var showingLogoutConfirm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Me") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Profile row
            currentUser?.let { user ->
                item {
                    Card(
                        onClick = { navController.navigate("profile") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.AccountCircle,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(user.name, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                                Text(
                                    "${user.username} · ${user.role.displayName}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Icon(Icons.Default.ChevronRight, contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            // Settings section
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        NavigationItem("Settings", Icons.Default.Settings) { navController.navigate("settings") }
                        if (currentUser?.role == com.inventoryborrowingsystem.data.UserRole.SUPERADMIN) {
                            HorizontalDivider()
                            NavigationItem("Email Alerts", Icons.Default.Email) { navController.navigate("email_alerts") }
                        }
                    }
                }
            }

            // Logout
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Surface(
                            onClick = { showingLogoutConfirm = true },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.ExitToApp, contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error)
                                Text("Log Out", style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showingLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showingLogoutConfirm = false },
            title = { Text("Log Out?") },
            text = { Text("Are you sure you want to log out?") },
            confirmButton = {
                Button(
                    onClick = { showingLogoutConfirm = false; viewModel.logout() },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("Log Out") }
            },
            dismissButton = { TextButton(onClick = { showingLogoutConfirm = false }) { Text("Cancel") } }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(viewModel: AppViewModel, navController: NavController) {
    val currentUser by viewModel.currentUser.collectAsState()
    var showingChangePassword by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Profile") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            currentUser?.let { user ->
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            DetailRow("Name", user.name)
                            HorizontalDivider()
                            DetailRow("Employee ID", user.username)
                            HorizontalDivider()
                            DetailRow("Role", user.role.displayName)
                            user.phone?.takeIf { it.isNotEmpty() }?.let {
                                HorizontalDivider()
                                DetailRow("Phone", it)
                            }
                            user.email?.takeIf { it.isNotEmpty() }?.let {
                                HorizontalDivider()
                                DetailRow("Email", it)
                            }
                        }
                    }
                }
            }
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    NavigationItem("Change Password", Icons.Default.Lock) { showingChangePassword = true }
                }
            }
        }
    }

    if (showingChangePassword) {
        ChangePasswordSheetDialog(viewModel = viewModel, required = false, onDismiss = { showingChangePassword = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(viewModel: AppViewModel, navController: NavController) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val coroutineScope = rememberCoroutineScope()

    val theme by viewModel.theme.collectAsState()
    val language by viewModel.language.collectAsState()
    val biometricEnabled by viewModel.biometricEnabled.collectAsState()
    val appLockEnabled by viewModel.appLockEnabled.collectAsState()
    val appLockDelay by viewModel.appLockDelay.collectAsState()
    val notificationsEnabled by viewModel.notificationsEnabled.collectAsState()
    val apiBaseUrl by viewModel.apiBaseUrl.collectAsState()

    var apiUrlInput by remember(apiBaseUrl) { mutableStateOf(apiBaseUrl) }

    val hasBiometricHardware = remember(context) {
        val mgr = BiometricManager.from(context)
        val result = mgr.canAuthenticate(BIOMETRIC_STRONG)
        result == BiometricManager.BIOMETRIC_SUCCESS ||
        result == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Theme
            item {
                SectionHeader("Appearance")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Theme", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            ThemeOption.entries.forEachIndexed { idx, opt ->
                                SegmentedButton(
                                    selected = theme == opt,
                                    onClick = { viewModel.updateTheme(opt) },
                                    shape = SegmentedButtonDefaults.itemShape(index = idx, count = ThemeOption.entries.size)
                                ) { Text(opt.title) }
                            }
                        }
                    }
                }
            }

            // Language
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Language", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            LanguageOption.entries.forEachIndexed { idx, opt ->
                                SegmentedButton(
                                    selected = language == opt,
                                    onClick = { viewModel.updateLanguage(opt) },
                                    shape = SegmentedButtonDefaults.itemShape(index = idx, count = LanguageOption.entries.size)
                                ) { Text(opt.title) }
                            }
                        }
                    }
                }
            }

            // Server node
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                        com.inventoryborrowingsystem.ui.components.ServerNodePicker(viewModel)
                    }
                }
            }

            // Location permission (tap opens system settings to allow/disable)
            item {
                val ctx = LocalContext.current
                val granted = viewModel.hasLocationPermission()
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                ctx.startActivity(
                                    Intent(
                                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.fromParts("package", ctx.packageName, null)
                                    )
                                )
                            }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Location", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            if (granted) "Allowed" else "Off — tap to enable",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (granted) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            // Notifications
            item {
                SectionHeader("Notifications")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Push Notifications", style = MaterialTheme.typography.bodyLarge)
                        Switch(
                            checked = notificationsEnabled,
                            onCheckedChange = { viewModel.updateNotificationsEnabled(it) }
                        )
                    }
                }
            }

            // Security
            if (hasBiometricHardware) {
                item {
                    SectionHeader("Security")
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Biometric Login", style = MaterialTheme.typography.bodyLarge)
                                Switch(
                                    checked = biometricEnabled,
                                    onCheckedChange = { enabled ->
                                        if (enabled) {
                                            activity?.let { viewModel.enrollBiometric(it) }
                                        } else {
                                            viewModel.updateBiometricEnabled(false)
                                        }
                                    }
                                )
                            }
                            if (biometricEnabled) {
                                HorizontalDivider()
                                Row(
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("App Lock", style = MaterialTheme.typography.bodyLarge)
                                    Switch(
                                        checked = appLockEnabled,
                                        onCheckedChange = { viewModel.updateAppLockEnabled(it) }
                                    )
                                }
                                if (appLockEnabled) {
                                    HorizontalDivider()
                                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("Lock after", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        AppLockDelay.entries.forEach { delay ->
                                            Row(
                                                modifier = Modifier.fillMaxWidth(),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(delay.title)
                                                RadioButton(
                                                    selected = appLockDelay == delay,
                                                    onClick = { viewModel.updateAppLockDelay(delay) }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // API URL
            item {
                SectionHeader("Server")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = apiUrlInput,
                            onValueChange = { apiUrlInput = it },
                            label = { Text("API Base URL") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None,
                                autoCorrect = false
                            )
                        )
                        Button(
                            onClick = {
                                viewModel.updateApiBaseUrl(apiUrlInput)
                                coroutineScope.launch {
                                    try { viewModel.refresh() } catch (_: Exception) {}
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Apply URL") }
                    }
                }
            }

            // Storage
            item {
                var cacheCleared by remember { mutableStateOf(false) }
                SectionHeader("Storage")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Surface(
                        onClick = {
                            context.cacheDir.deleteRecursively()
                            cacheCleared = true
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Clear Cache", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                if (cacheCleared) "Cleared" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChangePasswordSheetDialog(viewModel: AppViewModel, required: Boolean, onDismiss: () -> Unit) {
    val coroutineScope = rememberCoroutineScope()
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(
        onDismissRequest = { if (!required && !isSubmitting) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Change Password", style = MaterialTheme.typography.titleLarge)
                Row {
                    if (!required) TextButton(onClick = { onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val cur = currentPassword.trim()
                            val np = newPassword.trim()
                            val cp = confirmPassword.trim()
                            if (np != cp) { errorMessage = "Passwords do not match."; return@Button }
                            if (np.isEmpty()) { errorMessage = "Please enter a new password."; return@Button }
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    viewModel.changePassword(cur, np, cp)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && currentPassword.isNotEmpty() && newPassword.isNotEmpty() && confirmPassword.isNotEmpty()
                    ) { Text(if (isSubmitting) "…" else "Save") }
                }
            }
            if (required) {
                Text("Your password has expired. Please set a new password.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error)
            }
            OutlinedTextField(
                value = currentPassword, onValueChange = { currentPassword = it },
                label = { Text("Current password") }, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password)
            )
            OutlinedTextField(
                value = newPassword, onValueChange = { newPassword = it },
                label = { Text("New password") }, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password)
            )
            OutlinedTextField(
                value = confirmPassword, onValueChange = { confirmPassword = it },
                label = { Text("Confirm password") }, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password)
            )
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
