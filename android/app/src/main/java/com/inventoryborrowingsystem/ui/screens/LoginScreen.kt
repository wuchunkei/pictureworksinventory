package com.inventoryborrowingsystem.ui.screens

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.inventoryborrowingsystem.data.CountryCodes
import com.inventoryborrowingsystem.ui.components.CountryCodePickerDialog
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch

private enum class LoginStep {
    EMPLOYEE, PASSWORD, REGISTER, RESET_PASSWORD_VERIFY, RESET_PASSWORD, IT_CONTACT
}

@Composable
fun LoginScreen(viewModel: AppViewModel) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val coroutineScope = rememberCoroutineScope()

    var step by remember { mutableStateOf(LoginStep.EMPLOYEE) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var phoneCountryCode by remember { mutableStateOf("+86") }
    var showCountryPicker by remember { mutableStateOf(false) }
    var nameInput by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var biometricFailures by remember { mutableStateOf(0) }
    var showBiometricUnavailable by remember { mutableStateOf(false) }

    val errorMessage by viewModel.errorMessage.collectAsState()

    val usernameFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val confirmPasswordFocus = remember { FocusRequester() }
    val phoneFocus = remember { FocusRequester() }
    val nameFocus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    val canUseBiometric = biometricFailures < 2 && activity != null && viewModel.biometricLoginAvailable(context)
    val hasBiometricHardware = remember(context) {
        val mgr = BiometricManager.from(context)
        val result = mgr.canAuthenticate(BIOMETRIC_STRONG)
        result == BiometricManager.BIOMETRIC_SUCCESS ||
        result == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
    }

    fun triggerBiometric() {
        activity ?: return
        viewModel.loginWithBiometric(activity) { success ->
            if (!success) biometricFailures++
        }
    }

    LaunchedEffect(Unit) {
        if (canUseBiometric && !viewModel.didJustLogout) {
            triggerBiometric()
        }
        viewModel.didJustLogout.let { /* reset flag is done after biometric check */ }
    }

    fun doSubmit() {
        if (isSubmitting) return
        isSubmitting = true
        coroutineScope.launch {
            try {
                when (step) {
                    LoginStep.EMPLOYEE -> {
                        val trimmedUsername = username.trim()
                        try {
                            val response = viewModel.loginStart(trimmedUsername)
                            displayName = response.user?.name ?: ""
                            when {
                                !response.exists -> viewModel.setError("Please contact IT.")
                                response.hasPassword && !response.resetRequired -> {
                                    viewModel.clearError()
                                    step = LoginStep.PASSWORD
                                }
                                response.resetRequired -> {
                                    viewModel.clearError()
                                    step = LoginStep.RESET_PASSWORD_VERIFY
                                }
                                else -> {
                                    viewModel.clearError()
                                    step = LoginStep.REGISTER
                                }
                            }
                        } catch (e: Exception) {
                            viewModel.setError(e.message ?: "Error")
                        }
                    }
                    LoginStep.PASSWORD -> viewModel.login(username, password)
                    LoginStep.REGISTER -> viewModel.register(username, password, confirmPassword, phone.trim(), phoneCountryCode)
                    LoginStep.RESET_PASSWORD_VERIFY -> {
                        try {
                            viewModel.verifyIdentity(username, nameInput.trim(), phone.trim())
                            viewModel.clearError()
                            step = LoginStep.RESET_PASSWORD
                        } catch (e: Exception) {
                            viewModel.setError(e.message ?: "Verification failed")
                        }
                    }
                    LoginStep.RESET_PASSWORD -> viewModel.resetPassword(username, password, confirmPassword, phone.trim(), phoneCountryCode)
                    LoginStep.IT_CONTACT -> {}
                }
            } finally {
                isSubmitting = false
            }
        }
    }

    val subtitle = when (step) {
        LoginStep.EMPLOYEE -> "Enter your employee ID to continue."
        LoginStep.PASSWORD -> "Welcome back, ${if (displayName.isEmpty()) username else displayName}!"
        LoginStep.REGISTER -> "Verify your phone and set a password."
        LoginStep.RESET_PASSWORD_VERIFY -> "Verify your identity to reset your password."
        LoginStep.RESET_PASSWORD -> "Identity verified. Set your new password."
        LoginStep.IT_CONTACT -> "Please contact IT."
    }

    val primaryButtonTitle = when (step) {
        LoginStep.EMPLOYEE -> "Next"
        LoginStep.PASSWORD -> "Log in"
        LoginStep.REGISTER -> "Register"
        LoginStep.RESET_PASSWORD_VERIFY -> "Verify"
        LoginStep.RESET_PASSWORD -> "Reset Password"
        LoginStep.IT_CONTACT -> "Back to login"
    }

    val canSubmit = when (step) {
        LoginStep.EMPLOYEE -> username.trim().isNotEmpty()
        LoginStep.RESET_PASSWORD_VERIFY -> username.trim().isNotEmpty() && nameInput.trim().isNotEmpty() && phone.trim().isNotEmpty()
        LoginStep.IT_CONTACT -> true
        else -> username.trim().isNotEmpty()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        if (step == LoginStep.IT_CONTACT) {
            ITContactView(
                onBack = {
                    viewModel.clearError()
                    step = LoginStep.EMPLOYEE
                }
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.Center
            ) {
                Spacer(Modifier.height(40.dp))

                // Server node selector (centered, no label)
                Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    com.inventoryborrowingsystem.ui.components.ServerNodePicker(viewModel, showLabel = false)
                }
                Spacer(Modifier.height(24.dp))

                // Title
                Text(
                    text = "Inventory",
                    style = MaterialTheme.typography.headlineLarge.copy(
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
                    )
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(24.dp))

                // Fields
                when (step) {
                    LoginStep.EMPLOYEE -> {
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("Employee ID") },
                            modifier = Modifier.fillMaxWidth().focusRequester(usernameFocus),
                            keyboardOptions = KeyboardOptions(
                                autoCorrect = false,
                                capitalization = KeyboardCapitalization.None,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(onDone = { doSubmit() }),
                            singleLine = true
                        )
                    }
                    LoginStep.PASSWORD -> {
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Password") },
                            modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(onDone = { doSubmit() }),
                            singleLine = true
                        )
                    }
                    LoginStep.REGISTER -> {
                        OutlinedTextField(
                            value = username,
                            onValueChange = {},
                            label = { Text("Employee ID") },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = false,
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Password") },
                            modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = confirmPassword,
                            onValueChange = { confirmPassword = it },
                            label = { Text("Confirm password") },
                            modifier = Modifier.fillMaxWidth().focusRequester(confirmPasswordFocus),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val sel = CountryCodes.all.firstOrNull { it.code == phoneCountryCode } ?: CountryCodes.recommended[0]
                            OutlinedButton(onClick = { showCountryPicker = true }) { Text("${sel.flag} ${sel.code}") }
                            OutlinedTextField(
                                value = phone,
                                onValueChange = { phone = it.filter { c -> c.isDigit() } },
                                label = { Text("Phone") },
                                modifier = Modifier.weight(1f).focusRequester(phoneFocus),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true
                            )
                        }
                    }
                    LoginStep.RESET_PASSWORD_VERIFY -> {
                        OutlinedTextField(
                            value = username,
                            onValueChange = {},
                            label = { Text("Employee ID") },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = false,
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = nameInput,
                            onValueChange = { nameInput = it },
                            label = { Text("Full name") },
                            modifier = Modifier.fillMaxWidth().focusRequester(nameFocus),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val sel = CountryCodes.all.firstOrNull { it.code == phoneCountryCode } ?: CountryCodes.recommended[0]
                            OutlinedButton(onClick = { showCountryPicker = true }) { Text("${sel.flag} ${sel.code}") }
                            OutlinedTextField(
                                value = phone,
                                onValueChange = { phone = it.filter { c -> c.isDigit() } },
                                label = { Text("Phone") },
                                modifier = Modifier.weight(1f).focusRequester(phoneFocus),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true
                            )
                        }
                    }
                    LoginStep.RESET_PASSWORD -> {
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("New password") },
                            modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            singleLine = true
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = confirmPassword,
                            onValueChange = { confirmPassword = it },
                            label = { Text("Confirm password") },
                            modifier = Modifier.fillMaxWidth().focusRequester(confirmPasswordFocus),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            singleLine = true
                        )
                    }
                    else -> {}
                }

                Spacer(Modifier.height(16.dp))

                // Submit row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = { doSubmit() },
                        modifier = Modifier.weight(1f),
                        enabled = !isSubmitting && canSubmit
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text(primaryButtonTitle)
                        }
                    }

                    if (step == LoginStep.EMPLOYEE && hasBiometricHardware) {
                        FilledTonalButton(
                            onClick = {
                                if (canUseBiometric) triggerBiometric()
                                else showBiometricUnavailable = true
                            },
                            enabled = !isSubmitting,
                            modifier = Modifier.width(56.dp)
                        ) {
                            Icon(Icons.Default.Fingerprint, contentDescription = "Biometric login",
                                modifier = Modifier.size(24.dp))
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                // Secondary controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    if (step != LoginStep.EMPLOYEE) {
                        TextButton(onClick = {
                            viewModel.clearError()
                            password = ""; confirmPassword = ""; nameInput = ""; phone = ""
                            step = LoginStep.EMPLOYEE
                        }) {
                            Text("< Wrong Account")
                        }
                    }
                    if (step == LoginStep.EMPLOYEE || step == LoginStep.PASSWORD) {
                        TextButton(
                            onClick = {
                                val trimmed = username.trim()
                                if (trimmed.isEmpty()) {
                                    viewModel.setError("Enter your employee ID first.")
                                    return@TextButton
                                }
                                viewModel.clearError()
                                username = trimmed; password = ""; confirmPassword = ""; nameInput = ""; phone = ""
                                step = LoginStep.RESET_PASSWORD_VERIFY
                                coroutineScope.launch { viewModel.forgotPassword(trimmed) }
                            },
                            modifier = Modifier.let { if (step == LoginStep.EMPLOYEE) it else it }
                        ) {
                            Text("Forgot Password >", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }

                // Error message
                if (errorMessage != null) {
                    Spacer(Modifier.height(8.dp))
                    if (errorMessage == "Please contact IT.") {
                        TextButton(onClick = {
                            viewModel.clearError()
                            step = LoginStep.IT_CONTACT
                        }) {
                            Text(
                                "Wrong employee ID, click here to contact IT",
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    } else {
                        Text(
                            text = errorMessage!!,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                Spacer(Modifier.height(80.dp))
            }
        }
    }

    if (showCountryPicker) {
        CountryCodePickerDialog(
            selected = phoneCountryCode,
            onSelect = { phoneCountryCode = it },
            onDismiss = { showCountryPicker = false }
        )
    }

    if (showBiometricUnavailable) {
        AlertDialog(
            onDismissRequest = { showBiometricUnavailable = false },
            title = { Text("Not available") },
            text = {
                Text(
                    if (biometricFailures >= 2)
                        "Too many failed attempts. Please log in with your employee ID and password."
                    else
                        "Please log in with your employee ID and password first."
                )
            },
            confirmButton = {
                TextButton(onClick = { showBiometricUnavailable = false }) { Text("OK") }
            }
        )
    }
}

@Composable
private fun ITContactView(onBack: () -> Unit) {
    data class ITContact(val name: String, val email: String, val phone: String)

    var selectedRegion by remember { mutableStateOf("Hong Kong") }

    val contact = when (selectedRegion) {
        "China" -> ITContact("Mark Gao", "mark.gao@pictureworks.com", "+86 136 6100 8218")
        else -> ITContact("John Hu", "john.hu@pictureworks.com", "+852 5262 9698")
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("IT Contact Information", style = MaterialTheme.typography.titleLarge)

                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    listOf("Hong Kong", "Macao", "China").forEachIndexed { idx, region ->
                        SegmentedButton(
                            selected = selectedRegion == region,
                            onClick = { selectedRegion = region },
                            shape = SegmentedButtonDefaults.itemShape(index = idx, count = 3)
                        ) { Text(region) }
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(contact.name, style = MaterialTheme.typography.titleMedium)
                    Text("Email: ${contact.email}", style = MaterialTheme.typography.bodyMedium)
                    Text("Phone: ${contact.phone}", style = MaterialTheme.typography.bodyMedium)
                }

                TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Back to login.")
                }
            }
        }
    }
}
