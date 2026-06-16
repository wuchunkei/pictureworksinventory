package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.SMTPSettings
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SMTPSettingsScreen(viewModel: AppViewModel, navController: NavController) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var smtp by remember { mutableStateOf(SMTPSettings()) }
    var saving by remember { mutableStateOf(false) }
    var testing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var messageIsError by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try { smtp = viewModel.fetchSMTPSettings() } catch (e: Exception) { loadError = e.message }
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Email Alerts") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } }
            )
        }
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            loadError != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(loadError!!, color = MaterialTheme.colorScheme.error)
            }
            else -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Enable email alerts", Modifier.weight(1f))
                    Switch(checked = smtp.enabled, onCheckedChange = { smtp = smtp.copy(enabled = it) })
                }
                Text("When on, daily stock-check and borrow/return/disposal approval notifications are also emailed to the relevant users (who have an email on file).",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

                Text("SMTP Server", style = MaterialTheme.typography.titleSmall)
                OutlinedTextField(value = smtp.host, onValueChange = { smtp = smtp.copy(host = it.trim()) }, label = { Text("Host") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = if (smtp.port == 0) "" else smtp.port.toString(), onValueChange = { smtp = smtp.copy(port = it.filter { c -> c.isDigit() }.toIntOrNull() ?: 0) },
                    label = { Text("Port") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Use SSL (port 465)", Modifier.weight(1f))
                    Switch(checked = smtp.secure, onCheckedChange = { smtp = smtp.copy(secure = it) })
                }

                Text("Authentication", style = MaterialTheme.typography.titleSmall)
                OutlinedTextField(value = smtp.username, onValueChange = { smtp = smtp.copy(username = it.trim()) }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = smtp.password, onValueChange = { smtp = smtp.copy(password = it) }, label = { Text("Password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())

                Text("Sender", style = MaterialTheme.typography.titleSmall)
                OutlinedTextField(value = smtp.fromName, onValueChange = { smtp = smtp.copy(fromName = it) }, label = { Text("From name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = smtp.fromAddress, onValueChange = { smtp = smtp.copy(fromAddress = it.trim()) }, label = { Text("From email") }, singleLine = true, modifier = Modifier.fillMaxWidth())

                Button(onClick = {
                    saving = true; message = null
                    scope.launch {
                        try { smtp = viewModel.updateSMTPSettings(smtp); message = "Saved."; messageIsError = false }
                        catch (e: Exception) { message = e.message; messageIsError = true } finally { saving = false }
                    }
                }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Text(if (saving) "Saving…" else "Save") }

                OutlinedButton(onClick = {
                    testing = true; message = null
                    scope.launch {
                        try {
                            smtp = viewModel.updateSMTPSettings(smtp)
                            val result = viewModel.testSMTP(null)
                            message = result; messageIsError = result.contains("fail", ignoreCase = true)
                            smtp = viewModel.fetchSMTPSettings()
                        } catch (e: Exception) { message = e.message; messageIsError = true } finally { testing = false }
                    }
                }, enabled = !testing && smtp.host.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text(if (testing) "Sending…" else "Send Test Email") }

                smtp.health?.let { h ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (h == "ok") Icon(Icons.Default.CheckCircle, null, tint = androidx.compose.ui.graphics.Color(0xFF1B873F))
                        else Icon(Icons.Default.Cancel, null, tint = MaterialTheme.colorScheme.error)
                        Text(if (h == "ok") "Last test: OK" else "Last test: failed", style = MaterialTheme.typography.bodySmall)
                    }
                }
                message?.let { Text(it, color = if (messageIsError) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color(0xFF1B873F), style = MaterialTheme.typography.bodySmall) }
                Text("The test email is sent to your profile email.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
