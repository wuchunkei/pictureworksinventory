package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.NotificationItem
import com.inventoryborrowingsystem.ui.components.EmptyState
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(viewModel: AppViewModel, navController: NavController) {
    val notifications by viewModel.notifications.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val currentUser by viewModel.currentUser.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val coroutineScope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current

    val canReview = permissions?.canReviewApprovals == true
    val myId = currentUser?.id
    fun amRecipient(n: NotificationItem) = n.recipientUserIds?.contains(myId) == true

    var pendingApproval by remember { mutableStateOf<NotificationItem?>(null) }
    var pendingDenial by remember { mutableStateOf<NotificationItem?>(null) }
    var pendingAcfSign by remember { mutableStateOf<NotificationItem?>(null) }
    var pendingAcfDeny by remember { mutableStateOf<NotificationItem?>(null) }
    var downloadingId by remember { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val sortedNotifications = remember(notifications) {
        notifications.sortedWith(Comparator { l, r ->
            if (l.status == "pending" && r.status != "pending") return@Comparator -1
            if (r.status == "pending" && l.status != "pending") return@Comparator 1
            (r.createdAt ?: "").compareTo(l.createdAt ?: "")
        })
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Notifications") }) }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refreshAsync() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            if (notifications.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState("No notifications", Icons.Default.NotificationsNone)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(sortedNotifications, key = { it.id }) { notification ->
                        val isAcf = notification.type.startsWith("acf_")
                        val isEndorserReq = notification.type == "acf_sign_request" && notification.status == "unread" && amRecipient(notification)
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                when {
                                    notification.type == "acf_completed" -> {
                                        val formId = notification.relatedEntityId ?: return@Card
                                        if (downloadingId != null) return@Card
                                        downloadingId = notification.id
                                        coroutineScope.launch {
                                            try {
                                                val (bytes, name) = viewModel.downloadAssetCheckForm(formId)
                                                shareAcfFile(context, bytes, name)
                                                if (notification.status == "unread") viewModel.markNotificationRead(notification)
                                            } catch (e: Exception) { errorMessage = e.message } finally { downloadingId = null }
                                        }
                                    }
                                    notification.type in listOf("acf_denied", "acf_withdrawn") && amRecipient(notification) -> {
                                        navController.navigate("acf_resubmit/${notification.relatedEntityId}")
                                        if (notification.status == "unread") coroutineScope.launch { viewModel.markNotificationRead(notification) }
                                    }
                                    notification.type == "unscanned_check" -> navController.navigate("notification_detail/${notification.id}")
                                    notification.type == "acf_sign_request" -> {}
                                    notification.status == "unread" -> coroutineScope.launch { viewModel.markNotificationRead(notification) }
                                }
                            }
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.Top
                                ) {
                                    Text(
                                        notification.title,
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                        modifier = Modifier.weight(1f)
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    NotificationStatusIndicator(notification.status)
                                }
                                if (notification.type == "acf_completed" && notification.acf != null) {
                                    AcfCompletedBody(notification.acf!!, context, onCopy = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(it)); toast = "Password copied" })
                                } else {
                                    Text(notification.body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                notification.createdAt?.let { dateStr ->
                                    val date = parseIso8601AndFormat(dateStr)
                                    if (date != null) {
                                        if (isAcf) Text("${date.first} ${date.second}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                                        else Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                                            Text(date.first, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                                            Text(date.second, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                                        }
                                    }
                                }
                                if (notification.status == "pending" && canReview) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                                        Button(onClick = { pendingApproval = notification }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) { Text("Approve", style = MaterialTheme.typography.labelMedium) }
                                        OutlinedButton(onClick = { pendingDenial = notification }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)) { Text("Deny", style = MaterialTheme.typography.labelMedium) }
                                    }
                                }
                                if (isEndorserReq) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                                        Button(onClick = { pendingAcfSign = notification }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) { Text("Sign", style = MaterialTheme.typography.labelMedium) }
                                        OutlinedButton(onClick = { pendingAcfDeny = notification }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)) { Text("Deny", style = MaterialTheme.typography.labelMedium) }
                                    }
                                }
                                if (notification.type == "acf_submitted" && notification.status == "unread" && amRecipient(notification)) {
                                    OutlinedButton(onClick = {
                                        val formId = notification.relatedEntityId ?: return@OutlinedButton
                                        coroutineScope.launch { try { viewModel.withdrawAssetCheckForm(formId) } catch (e: Exception) { errorMessage = e.message } }
                                    }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)) { Text("Withdraw", style = MaterialTheme.typography.labelMedium) }
                                }
                                if (notification.type in listOf("acf_denied", "acf_withdrawn") && amRecipient(notification)) {
                                    Text("Tap to review and resubmit", style = MaterialTheme.typography.labelMedium, color = Color(0xFF007AFF), modifier = Modifier.padding(top = 4.dp))
                                }
                                if (notification.type == "acf_completed") {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                                        if (downloadingId == notification.id) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                                        else Icon(Icons.Default.Download, null, Modifier.size(16.dp), tint = Color(0xFF007AFF))
                                        Text("Click this notification to download", style = MaterialTheme.typography.labelMedium, color = Color(0xFF007AFF))
                                    }
                                }
                                notification.reviewNote?.takeIf { it.isNotEmpty() }?.let { note ->
                                    Text("Note: $note", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Approve confirmation dialog
    pendingApproval?.let { notif ->
        AlertDialog(
            onDismissRequest = { pendingApproval = null },
            title = { Text("Approve this request?") },
            text = { Text(notif.body) },
            confirmButton = {
                Button(onClick = {
                    val n = notif
                    pendingApproval = null
                    coroutineScope.launch {
                        try {
                            viewModel.reviewNotification(n.id, true, null)
                        } catch (e: Exception) {
                            errorMessage = e.message
                        }
                    }
                }) { Text("Approve") }
            },
            dismissButton = {
                TextButton(onClick = { pendingApproval = null }) { Text("Cancel") }
            }
        )
    }

    // Deny sheet
    pendingDenial?.let { notif ->
        DenySheetDialog(
            notification = notif,
            viewModel = viewModel,
            onDismiss = { pendingDenial = null }
        )
    }

    // ACF sign sheet
    pendingAcfSign?.let { notif ->
        AcfSignSheet(notif, viewModel, onDismiss = { pendingAcfSign = null })
    }
    // ACF deny sheet
    pendingAcfDeny?.let { notif ->
        AcfDenySheet(notif, viewModel, onDismiss = { pendingAcfDeny = null })
    }

    toast?.let { msg ->
        LaunchedEffect(msg) { kotlinx.coroutines.delay(1600); toast = null }
        androidx.compose.material3.Snackbar(modifier = Modifier.padding(16.dp)) { Text(msg) }
    }

    errorMessage?.let { msg ->
        AlertDialog(
            onDismissRequest = { errorMessage = null },
            title = { Text("Error") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { errorMessage = null }) { Text("OK") } }
        )
    }
}

@Composable
private fun NotificationStatusIndicator(status: String) {
    when (status) {
        "pending" -> Text("Pending",
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = Color(0xFFFF9500))
        "unread" -> Box(
            modifier = Modifier.size(8.dp).clip(CircleShape),
            contentAlignment = Alignment.Center
        ) { Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF007AFF)) {} }
        "approved" -> Icon(Icons.Default.CheckCircle, contentDescription = null,
            modifier = Modifier.size(16.dp), tint = Color(0xFF34C759))
        "denied" -> Icon(Icons.Default.Cancel, contentDescription = null,
            modifier = Modifier.size(16.dp), tint = Color(0xFFFF3B30))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DenySheetDialog(
    notification: NotificationItem,
    viewModel: AppViewModel,
    onDismiss: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Deny Request", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val r = reason.trim()
                            if (r.isEmpty()) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    viewModel.reviewNotification(notification.id, false, r)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && reason.trim().isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    ) { Text(if (isSubmitting) "…" else "Deny") }
                }
            }
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Reason for denial") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3
            )
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationDetailScreen(viewModel: AppViewModel, notificationId: String, navController: NavController) {
    val notifications by viewModel.notifications.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val notification = notifications.firstOrNull { it.id == notificationId }

    val items = remember(notification, skus) {
        val ids = notification?.skuIds?.toSet() ?: emptySet()
        skus.filter { ids.contains(it.id) }.sortedBy { it.displayCode }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(notification?.title ?: "Notification") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        }
    ) { padding ->
        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                EmptyState("No items found", Icons.Default.Inventory2)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(items) { item ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(item.displayCode, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold))
                            item.serialNumber?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            item.descriptionText?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AcfCompletedBody(meta: com.inventoryborrowingsystem.data.ACFNotificationMeta, context: android.content.Context, onCopy: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Submitted by", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            CallableName(meta.requesterName, meta.requesterPhone, context)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Approved by", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            CallableName(meta.endorserName, meta.endorserPhone, context)
        }
        meta.password?.takeIf { it.isNotEmpty() }?.let { pw ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("PDF edit password:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(pw, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = Color(0xFF007AFF),
                    modifier = Modifier.clickable { onCopy(pw) })
            }
        }
    }
}

@Composable
private fun CallableName(name: String?, phone: String?, context: android.content.Context) {
    val display = name ?: "—"
    if (!phone.isNullOrEmpty()) {
        Text(display, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = Color(0xFF007AFF),
            modifier = Modifier.clickable {
                val digits = phone.filter { it.isDigit() || it == '+' }
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_DIAL, android.net.Uri.parse("tel:$digits")))
            })
    } else Text(display, style = MaterialTheme.typography.bodyMedium)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AcfSignSheet(notification: NotificationItem, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sig = com.inventoryborrowingsystem.ui.components.rememberSignatureState()
    var sigVersion by remember { mutableStateOf(0) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val hasSig = run { sigVersion; !sig.isEmpty }

    ModalBottomSheet(onDismissRequest = { if (!submitting) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Sign Asset Form", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!submitting) onDismiss() }) { Text("Cancel") }
                    Button(onClick = {
                        val png = sig.toBase64Png() ?: return@Button
                        val formId = notification.relatedEntityId ?: return@Button
                        submitting = true
                        scope.launch {
                            try { viewModel.signAssetCheckForm(formId, png); viewModel.markNotificationRead(notification); onDismiss() }
                            catch (e: Exception) { error = e.message } finally { submitting = false }
                        }
                    }, enabled = !submitting && hasSig) { Text(if (submitting) "…" else "Sign") }
                }
            }
            Text(notification.body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.fillMaxWidth().height(160.dp).border(1.dp, Color(0x33888888), androidx.compose.foundation.shape.RoundedCornerShape(8.dp))) {
                com.inventoryborrowingsystem.ui.components.SignaturePad(sig, onChange = { sigVersion++ })
                if (!hasSig) Text("Sign here", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { sig.clear(); sigVersion++ }, enabled = hasSig) { Text("Clear") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AcfDenySheet(notification: NotificationItem, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = { if (!submitting) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Deny Asset Form", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!submitting) onDismiss() }) { Text("Cancel") }
                    Button(onClick = {
                        val r = reason.trim(); if (r.isEmpty()) return@Button
                        val formId = notification.relatedEntityId ?: return@Button
                        submitting = true
                        scope.launch { try { viewModel.denyAssetCheckForm(formId, r); viewModel.markNotificationRead(notification); onDismiss() } catch (e: Exception) { error = e.message } finally { submitting = false } }
                    }, enabled = !submitting && reason.trim().isNotEmpty(), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text(if (submitting) "…" else "Deny") }
                }
            }
            OutlinedTextField(value = reason, onValueChange = { reason = it }, label = { Text("Reason for denial") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

private fun parseIso8601AndFormat(dateStr: String): Pair<String, String>? {
    val formats = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'"
    )
    for (fmt in formats) {
        try {
            val sdf = SimpleDateFormat(fmt, Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            val date = sdf.parse(dateStr) ?: continue
            val d = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getDefault() }.format(date)
            val t = SimpleDateFormat("HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getDefault() }.format(date)
            return d to t
        } catch (_: Exception) {}
    }
    return null
}
