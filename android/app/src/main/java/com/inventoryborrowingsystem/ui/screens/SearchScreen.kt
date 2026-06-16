package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.google.accompanist.permissions.*
import com.inventoryborrowingsystem.data.SKUAction
import com.inventoryborrowingsystem.data.SKUItem
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.data.UserRole
import com.inventoryborrowingsystem.ui.components.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SearchMode(val label: String, val placeholder: String) {
    QRC("QRC", "SKU Code"),
    SKU("SKU", "SKU Code"),
    SN("SN", "Serial Number")
}

@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(viewModel: AppViewModel) {
    val currentUser by viewModel.currentUser.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val records by viewModel.records.collectAsState()

    val canTypeSearch = currentUser?.role == UserRole.ADMIN || currentUser?.role == UserRole.SUPERADMIN
    val availableModes = if (canTypeSearch) SearchMode.entries else listOf(SearchMode.QRC)

    var mode by remember { mutableStateOf(SearchMode.QRC) }
    var query by remember { mutableStateOf("") }
    var foundItem by remember { mutableStateOf<SKUItem?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var isCameraActive by remember { mutableStateOf(false) }
    var pendingAction by remember { mutableStateOf<SKUAction?>(null) }
    var pendingActionItem by remember { mutableStateOf<SKUItem?>(null) }
    var showingActionScanner by remember { mutableStateOf(false) }
    var showingRepairSheet by remember { mutableStateOf(false) }
    var repairItemAfterScan by remember { mutableStateOf<SKUItem?>(null) }

    val coroutineScope = rememberCoroutineScope()
    var lookupJob by remember { mutableStateOf<Job?>(null) }
    val focusManager = LocalFocusManager.current

    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)

    LaunchedEffect(Unit) {
        isCameraActive = true
        if (!canTypeSearch) mode = SearchMode.QRC
    }

    DisposableEffect(Unit) {
        onDispose {
            isCameraActive = false
            lookupJob?.cancel()
        }
    }

    LaunchedEffect(showingActionScanner) {
        if (!showingActionScanner) isCameraActive = true
    }

    fun isValidSKUCode(value: String): Boolean {
        return Regex("^[A-Z0-9]+-[A-Z0-9]+-\\d{4}$").matches(value)
    }

    suspend fun doLookup() {
        val normalized = query.trim().uppercase()
        if (normalized.isEmpty()) { foundItem = null; message = null; return }
        if (mode == SearchMode.QRC || mode == SearchMode.SKU) {
            if (!isValidSKUCode(normalized)) { foundItem = null; message = null; return }
            try {
                foundItem = viewModel.lookupSKU(normalized)
                message = null
            } catch (e: Exception) {
                foundItem = null
                message = e.message
            }
        } else {
            foundItem = viewModel.findBySerial(normalized)
            message = if (foundItem == null) "No equipment found." else null
        }
    }

    fun scheduleLookup() {
        lookupJob?.cancel()
        lookupJob = coroutineScope.launch {
            delay(150)
            doLookup()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Search") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            GlassPanel {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (canTypeSearch) {
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            availableModes.forEachIndexed { idx, m ->
                                SegmentedButton(
                                    selected = mode == m,
                                    onClick = {
                                        mode = m
                                        query = ""; foundItem = null; message = null
                                    },
                                    shape = SegmentedButtonDefaults.itemShape(index = idx, count = availableModes.size)
                                ) { Text(m.label) }
                            }
                        }
                    }

                    if (mode == SearchMode.QRC) {
                        when {
                            cameraPermission.status.isGranted -> {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(180.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                ) {
                                    ScannerView(
                                        isScanning = isCameraActive,
                                        onCodeScanned = { code ->
                                            val extracted = extractSKUCode(code)
                                            if (extracted != null) {
                                                query = extracted
                                                lookupJob?.cancel()
                                                coroutineScope.launch { doLookup() }
                                            } else {
                                                message = "QR code does not contain a valid SKU code."
                                            }
                                        }
                                    )
                                }
                                if (query.isNotEmpty()) {
                                    Text("Scanned: $query",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            cameraPermission.status.shouldShowRationale || !cameraPermission.status.isGranted -> {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text("Camera permission required to scan QR codes",
                                        style = MaterialTheme.typography.bodyMedium)
                                    Button(onClick = { cameraPermission.launchPermissionRequest() }) {
                                        Text("Grant Permission")
                                    }
                                }
                            }
                        }
                    } else {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it; scheduleLookup() },
                            label = { Text(mode.placeholder) },
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(
                                capitalization = if (mode == SearchMode.SKU) KeyboardCapitalization.Characters else KeyboardCapitalization.None,
                                autoCorrect = false,
                                imeAction = ImeAction.Search
                            ),
                            keyboardActions = KeyboardActions(onSearch = {
                                focusManager.clearFocus()
                                coroutineScope.launch { doLookup() }
                            }),
                            singleLine = true
                        )
                    }
                }
            }

            message?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            foundItem?.let { item ->
                GlassPanel {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        SKUCard(item = item)

                        // Item context
                        when (item.status) {
                            SKUStatus.AVAILABLE -> {
                                val latestRecord = records.firstOrNull { it.skuId == item.id }
                                if (latestRecord != null) {
                                    HorizontalDivider()
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Icon(Icons.Default.History, contentDescription = null,
                                                modifier = Modifier.size(12.dp),
                                                tint = recordColor(latestRecord.type))
                                            Text(
                                                recordLabel(latestRecord.type),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                        latestRecord.createdAt?.let { at ->
                                            Text(formatShortDate(at),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                }
                            }
                            SKUStatus.BORROWED -> {
                                item.borrowedByName?.let { name ->
                                    HorizontalDivider()
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Default.Person, contentDescription = null,
                                            modifier = Modifier.size(12.dp),
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text("Borrowed by $name",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            SKUStatus.REPAIRING -> {
                                item.repairRequestedByName?.let { name ->
                                    HorizontalDivider()
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Default.Build, contentDescription = null,
                                            modifier = Modifier.size(12.dp),
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text("Repair requested by $name",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            else -> {}
                        }

                        // Action buttons
                        val actions = when (item.status) {
                            SKUStatus.AVAILABLE -> listOf(SKUAction.BORROW, SKUAction.REPAIR)
                            SKUStatus.BORROWED -> listOf(SKUAction.RETURN_ITEM)
                            SKUStatus.REPAIRING -> listOf(SKUAction.REPAIRED)
                            else -> emptyList()
                        }

                        if (actions.isEmpty()) {
                            Text("No action is available for this status.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                actions.forEach { action ->
                                    Button(
                                        onClick = {
                                            pendingAction = action
                                            pendingActionItem = item
                                            isCameraActive = false
                                            showingActionScanner = true
                                        },
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text(action.title)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Action scanner bottom sheet
    if (showingActionScanner && pendingAction != null && pendingActionItem != null) {
        InlineActionScanSheet(
            item = pendingActionItem!!,
            action = pendingAction!!,
            viewModel = viewModel,
            onDismiss = { showingActionScanner = false },
            onResult = { success ->
                showingActionScanner = false
                if (success) {
                    if (pendingAction == SKUAction.REPAIR) {
                        repairItemAfterScan = pendingActionItem
                        showingRepairSheet = true
                    } else {
                        foundItem = viewModel.skus.value.firstOrNull { it.id == pendingActionItem?.id } ?: foundItem
                    }
                }
            }
        )
    }

    // Repair sheet
    if (showingRepairSheet && repairItemAfterScan != null) {
        RepairSheetDialog(
            sku = repairItemAfterScan!!,
            viewModel = viewModel,
            onDismiss = {
                showingRepairSheet = false
                foundItem = viewModel.skus.value.firstOrNull { it.id == repairItemAfterScan?.id } ?: foundItem
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun InlineActionScanSheet(
    item: SKUItem,
    action: SKUAction,
    viewModel: AppViewModel,
    onDismiss: () -> Unit,
    onResult: (Boolean) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var isActioning by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var scannedCode by remember { mutableStateOf<String?>(null) }

    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)

    val scanTitle = when (action) {
        SKUAction.BORROW -> "Scan to Borrow"
        SKUAction.RETURN_ITEM -> "Scan to Return"
        SKUAction.REPAIR -> "Scan for Repair"
        SKUAction.REPAIRED -> "Scan to Return from Repair"
    }

    fun executeAction() {
        isActioning = true
        errorMessage = null
        coroutineScope.launch {
            try {
                viewModel.runAction(action, item.displayCode)
                onDismiss()
                onResult(true)
            } catch (e: Exception) {
                errorMessage = e.message
                scannedCode = null
            } finally {
                isActioning = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!isActioning) onDismiss() }) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(scanTitle, style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { if (!isActioning) onDismiss() }) { Text("Cancel") }
            }

            Text(
                "Scan the QR code on the item to confirm.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            if (cameraPermission.status.isGranted) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(220.dp)
                        .clip(RoundedCornerShape(16.dp))
                ) {
                    ScannerView(
                        isScanning = scannedCode == null && !isActioning,
                        onCodeScanned = { code ->
                            if (scannedCode != null) return@ScannerView
                            val extracted = extractSKUCode(code)
                            val expected = item.displayCode.uppercase()
                            if (extracted == expected) {
                                scannedCode = extracted
                                if (action == SKUAction.REPAIR) {
                                    onDismiss()
                                    onResult(true)
                                } else {
                                    executeAction()
                                }
                            } else {
                                errorMessage = "Scanned code \"${extracted ?: code}\" does not match ${item.displayCode}."
                            }
                        }
                    )
                }
            } else {
                Button(onClick = { cameraPermission.launchPermissionRequest() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Grant Camera Permission")
                }
            }

            if (isActioning) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text("Processing…")
                }
            }

            errorMessage?.let { msg ->
                Text(msg, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { errorMessage = null; scannedCode = null }) { Text("Try Again") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepairSheetDialog(sku: SKUItem, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val coroutineScope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Request Repair", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val r = reason.trim(); val d = destination.trim()
                            if (r.isEmpty() || d.isEmpty()) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    viewModel.requestRepair(sku.displayCode, r, d)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && reason.trim().isNotEmpty() && destination.trim().isNotEmpty()
                    ) { Text(if (isSubmitting) "…" else "Submit") }
                }
            }
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Reason for repair") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3
            )
            OutlinedTextField(
                value = destination,
                onValueChange = { destination = it },
                label = { Text("Send to (destination)") },
                modifier = Modifier.fillMaxWidth()
            )
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
