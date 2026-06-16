package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import com.inventoryborrowingsystem.data.SKUAction
import com.inventoryborrowingsystem.data.UserRole
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.inventoryborrowingsystem.data.SKUItem
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.ui.components.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventoryScreen(viewModel: AppViewModel, navController: NavController) {
    val skus by viewModel.skus.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val companies by viewModel.companies.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()

    val currentUser by viewModel.currentUser.collectAsState()
    var filterStatus by remember { mutableStateOf<SKUStatus?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var showingAdd by remember { mutableStateOf(false) }
    var showingExport by remember { mutableStateOf(false) }
    var showingImport by remember { mutableStateOf(false) }
    val canExport = currentUser?.role == UserRole.ADMIN || currentUser?.role == UserRole.SUPERADMIN

    val displayedSKUs = remember(skus, filterStatus, searchQuery) {
        var base = if (filterStatus != null) skus.filter { it.status == filterStatus } else skus
        if (searchQuery.isNotBlank()) {
            val q = searchQuery.trim().lowercase()
            base = base.filter {
                it.displayCode.lowercase().contains(q) ||
                it.serialNumber?.lowercase()?.contains(q) == true ||
                it.descriptionText?.lowercase()?.contains(q) == true
            }
        }
        base.sortedBy { it.displayCode }
    }

    val canManage = permissions?.canManageInventory == true

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Inventory") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (canManage) {
                        IconButton(onClick = { showingImport = true }, enabled = companies.isNotEmpty()) {
                            Icon(Icons.Default.Download, contentDescription = "Import Asset Form")
                        }
                    }
                    if (canExport) {
                        IconButton(onClick = { showingExport = true }, enabled = companies.isNotEmpty()) {
                            Icon(Icons.Default.Share, contentDescription = "Export Asset Form")
                        }
                    }
                    if (canManage) {
                        IconButton(
                            onClick = { showingAdd = true },
                            enabled = companies.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Add item")
                        }
                    }
                }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refreshAsync() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Search by SKU code or serial") },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = { if (searchQuery.isNotEmpty()) IconButton(onClick = { searchQuery = "" }) { Icon(Icons.Default.Clear, null) } },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 2.dp),
                    singleLine = true
                )
                // Filter chips
                LazyRow(
                    contentPadding = PaddingValues(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item {
                        FilterChip(
                            selected = filterStatus == null,
                            onClick = { filterStatus = null },
                            label = { Text("All") }
                        )
                    }
                    items(SKUStatus.entries) { status ->
                        FilterChip(
                            selected = filterStatus == status,
                            onClick = { filterStatus = status },
                            label = { Text(status.displayName) }
                        )
                    }
                }

                if (displayedSKUs.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState("No items", Icons.Default.Inventory2)
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(displayedSKUs, key = { it.id }) { sku ->
                            Card(
                                onClick = { navController.navigate("sku_detail/${sku.id}") },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(
                                        modifier = Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Text(
                                            sku.displayCode,
                                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                            color = skuCodeColor(sku)
                                        )
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            sku.categoryCode?.takeIf { it.isNotEmpty() }?.let {
                                                Text(it, style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                            sku.parkName?.takeIf { it.isNotEmpty() }?.let {
                                                Text(it, style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                        }
                                        if (sku.status == SKUStatus.BORROWED && !sku.borrowedByName.isNullOrEmpty()) {
                                            Text(sku.borrowedByName!!, style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                                        }
                                    }
                                    StatusPill(status = sku.status)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showingAdd) {
        AddSKUSheetDialog(viewModel = viewModel, onDismiss = { showingAdd = false })
    }
    if (showingExport) {
        ExportACFSheet(viewModel = viewModel, onDismiss = { showingExport = false })
    }
    if (showingImport) {
        ImportACFSheet(viewModel = viewModel, onDismiss = { showingImport = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SKUDetailScreen(viewModel: AppViewModel, skuId: String, navController: NavController) {
    val skus by viewModel.skus.collectAsState()
    val records by viewModel.records.collectAsState()
    val users by viewModel.users.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val companies by viewModel.companies.collectAsState()
    val currentUser by viewModel.currentUser.collectAsState()

    val sku = skus.firstOrNull { it.id == skuId }

    var showingRepair by remember { mutableStateOf(false) }
    var showingTransfer by remember { mutableStateOf(false) }
    var showingDisposal by remember { mutableStateOf(false) }
    var showingReturnScan by remember { mutableStateOf(false) }
    var showingRepairScanner by remember { mutableStateOf(false) }
    var showingEdit by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    val canManage = permissions?.canManageInventory == true
    val isSuperadmin = currentUser?.role == UserRole.SUPERADMIN

    val recentRecords = remember(records, sku) {
        if (sku == null) emptyList()
        else {
            val cal = Calendar.getInstance()
            cal.add(Calendar.DAY_OF_YEAR, -7)
            val cutoff = cal.time
            records.filter { record ->
                record.skuId == sku.id &&
                (parseIso8601(record.createdAt ?: "") ?: Date(0)).after(cutoff)
            }
        }
    }

    if (sku == null) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Item Detail") },
                    navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }}
                )
            }
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Item not found", color = MaterialTheme.colorScheme.error)
            }
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(sku.displayCode) },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                }}
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // SKU Card
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        SKUCard(item = sku)
                    }
                }
            }

            // Details section
            item {
                SectionHeader("Details")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        sku.companyName?.takeIf { it.isNotEmpty() }?.let {
                            DetailRow("Company", it)
                            HorizontalDivider()
                        }
                        sku.parkName?.takeIf { it.isNotEmpty() }?.let {
                            DetailRow("Branch", it)
                            HorizontalDivider()
                        }
                        sku.categoryCode?.takeIf { it.isNotEmpty() }?.let {
                            DetailRow("Category", it)
                            HorizontalDivider()
                        }
                        sku.serialNumber?.takeIf { it.isNotEmpty() }?.let {
                            DetailRow("Serial", it)
                        }
                    }
                }
            }

            // Status section
            if (sku.status == SKUStatus.BORROWED) {
                item {
                    SectionHeader("Borrower")
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            sku.borrowedByName?.let { DetailRow("Name", it); HorizontalDivider() }
                            sku.borrowedByUsername?.let { DetailRow("ID", it); HorizontalDivider() }
                            sku.borrowedAt?.let { DetailRow("Since", formatTimestamp(it)) }
                        }
                    }
                }
            } else if (sku.status == SKUStatus.REPAIRING) {
                item {
                    SectionHeader("Repair Request")
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            sku.repairRequestedByName?.takeIf { it.isNotEmpty() }?.let { DetailRow("Requested by", it); HorizontalDivider() }
                            sku.repairReason?.takeIf { it.isNotEmpty() }?.let { DetailRow("Reason", it); HorizontalDivider() }
                            sku.repairDestination?.takeIf { it.isNotEmpty() }?.let { DetailRow("Send to", it); HorizontalDivider() }
                            sku.repairStartedAt?.takeIf { it.isNotEmpty() }?.let { DetailRow("Since", formatTimestamp(it)) }
                        }
                    }
                }
            }

            // Actions section
            item {
                SectionHeader("Actions")
                actionError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 8.dp))
                }
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        when (sku.status) {
                            SKUStatus.AVAILABLE -> {
                                if (canManage) {
                                    if (isSuperadmin) {
                                        ActionRow("Edit Item", Icons.Default.Edit) { showingEdit = true }
                                        HorizontalDivider()
                                    }
                                    ActionRow("Request Repair", Icons.Default.Build) { showingRepairScanner = true }
                                    HorizontalDivider()
                                    ActionRow("Transfer", Icons.Default.SwapHoriz) { showingTransfer = true }
                                    HorizontalDivider()
                                    ActionRow("Request Disposal", Icons.Default.DeleteOutline,
                                        tint = MaterialTheme.colorScheme.error) { showingDisposal = true }
                                } else {
                                    Box(Modifier.padding(16.dp)) {
                                        Text("No actions available.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            SKUStatus.BORROWED -> {
                                ActionRow("Return", Icons.Default.KeyboardReturn) {
                                    actionError = null
                                    showingReturnScan = true
                                }
                            }
                            SKUStatus.REPAIRING -> {
                                ActionRow("Return from Repair", Icons.Default.CheckCircleOutline) {
                                    actionError = null
                                    showingReturnScan = true
                                }
                            }
                            else -> {
                                Box(Modifier.padding(16.dp)) {
                                    Text("No actions available.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }

            // Activity log
            item {
                SectionHeader("Recent Activity (7 days)")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        if (recentRecords.isEmpty()) {
                            Box(Modifier.padding(16.dp)) {
                                Text("No activity in the past 7 days.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        } else {
                            recentRecords.forEachIndexed { idx, record ->
                                Row(
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier.size(22.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(Icons.Default.Circle, contentDescription = null,
                                            modifier = Modifier.size(8.dp),
                                            tint = recordColor(record.type))
                                    }
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(recordLabel(record.type), style = MaterialTheme.typography.bodyMedium)
                                        val opName = record.operatorId?.let { opId -> users.firstOrNull { it.id == opId }?.name }
                                        opName?.let {
                                            Text(it, style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                    record.createdAt?.let {
                                        Text(formatShortDate(it), style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                if (idx < recentRecords.size - 1) HorizontalDivider()
                            }
                        }
                    }
                }
            }
        }
    }

    // Return scan sheet
    if (showingReturnScan) {
        ReturnScanSheetDialog(
            item = sku,
            viewModel = viewModel,
            onDismiss = { showingReturnScan = false },
            onResult = { success ->
                showingReturnScan = false
                if (!success) actionError = "QR code does not match this item."
            }
        )
    }

    // Repair scanner sheet
    if (showingRepairScanner) {
        InlineActionScanSheet(
            item = sku,
            action = SKUAction.REPAIR,
            viewModel = viewModel,
            onDismiss = { showingRepairScanner = false },
            onResult = { success ->
                showingRepairScanner = false
                if (success) showingRepair = true
            }
        )
    }

    // Repair form sheet
    if (showingRepair) {
        RepairSheetDialog(sku = sku, viewModel = viewModel, onDismiss = { showingRepair = false })
    }

    // Transfer sheet
    if (showingTransfer) {
        TransferSheetDialog(sku = sku, viewModel = viewModel, companies = companies, onDismiss = { showingTransfer = false })
    }

    // Disposal sheet
    if (showingDisposal) {
        DisposalSheetDialog(sku = sku, viewModel = viewModel, onDismiss = { showingDisposal = false })
    }

    // Edit sheet (superadmin, available only)
    if (showingEdit) {
        EditSKUSheetDialog(sku = sku, viewModel = viewModel, onDismiss = { showingEdit = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditSKUSheetDialog(sku: SKUItem, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val companies by viewModel.companies.collectAsState()
    val allSkus by viewModel.skus.collectAsState()
    val scope = rememberCoroutineScope()

    val company = companies.firstOrNull { it.id == sku.warehouseId }
    val availableBranches = company?.branches?.sortedBy { it.name } ?: emptyList()
    val availableCategories = company?.categories?.sortedBy { it.code } ?: emptyList()
    val availableDescriptions = company?.descriptions ?: emptyList()

    var branchId by remember { mutableStateOf(sku.branchId ?: "") }
    var locationId by remember { mutableStateOf(sku.locationId ?: "") }
    var categoryId by remember { mutableStateOf(sku.categoryId ?: "") }
    var skuNumberInput by remember { mutableStateOf((sku.skuCode ?: "").substringAfterLast("-", "")) }
    var descriptionId by remember { mutableStateOf(sku.descriptionId) }
    var customDescription by remember { mutableStateOf(if (sku.descriptionId == null) (sku.descriptionText ?: "") else "") }
    var serial by remember { mutableStateOf(sku.serialNumber ?: "") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val selectedBranch = availableBranches.firstOrNull { it.id == branchId }
    val availableLocations = selectedBranch?.locations?.sortedBy { it.name } ?: emptyList()
    val branchHasLocations = availableLocations.isNotEmpty()

    // Numbers already used in this company+category (excluding this SKU).
    val usedNumbers = remember(allSkus, categoryId, sku.id) {
        allSkus.filter { it.id != sku.id && it.warehouseId == sku.warehouseId && it.categoryId == categoryId }
            .mapNotNull { (it.skuCode ?: "").substringAfterLast("-", "").toIntOrNull() }.toSet()
    }
    val isAutoFill = skuNumberInput.isBlank()
    val effectiveNumber: Int? = if (isAutoFill) { var n = 1; while (usedNumbers.contains(n)) n++; n } else skuNumberInput.toIntOrNull()
    val isDuplicate = !isAutoFill && effectiveNumber != null && usedNumbers.contains(effectiveNumber)
    val paddedNumber = effectiveNumber?.let { String.format("%04d", it) }
    val skuPreview = if (company?.code != null && categoryId.isNotEmpty() && paddedNumber != null) {
        val cat = availableCategories.firstOrNull { it.id == categoryId }?.code ?: "???"
        "${company.code}-$cat-$paddedNumber"
    } else null

    val canSubmit = branchId.isNotEmpty() && (!branchHasLocations || locationId.isNotEmpty()) &&
            categoryId.isNotEmpty() && effectiveNumber != null && !isDuplicate

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Edit Item", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(onClick = {
                        if (!canSubmit) return@Button
                        isSubmitting = true
                        scope.launch {
                            try {
                                val descText = if (descriptionId == null) customDescription.trim().ifEmpty { null } else null
                                viewModel.updateSKU(sku.id, categoryId, branchId,
                                    if (locationId.isEmpty()) null else locationId,
                                    paddedNumber, descriptionId, descText, serial.trim().ifEmpty { null })
                                onDismiss()
                            } catch (e: Exception) { errorMessage = e.message } finally { isSubmitting = false }
                        }
                    }, enabled = !isSubmitting && canSubmit) { Text(if (isSubmitting) "…" else "Save") }
                }
            }
            // SKU number + preview
            OutlinedTextField(value = skuNumberInput, onValueChange = { v -> skuNumberInput = v.filter { it.isDigit() }.take(4) },
                label = { Text("Number (blank = auto)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number))
            skuPreview?.let {
                Text((if (isAutoFill) "auto · " else "") + it,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                    color = if (isDuplicate) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color(0xFF1B873F))
            }
            if (isDuplicate) Text("This SKU code already exists — pick another number or leave blank.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)

            // Branch
            DropdownField("Branch", selectedBranch?.name ?: "", availableBranches.map { it.id to it.name }) { branchId = it; locationId = "" }
            if (branchHasLocations) {
                DropdownField("Location", availableLocations.firstOrNull { it.id == locationId }?.name ?: "", availableLocations.map { it.id to it.name }) { locationId = it }
            }
            DropdownField("Category", availableCategories.firstOrNull { it.id == categoryId }?.code ?: "", availableCategories.map { it.id to it.code }) { categoryId = it }

            // Description
            if (availableDescriptions.isNotEmpty()) {
                DropdownField("Description preset", availableDescriptions.firstOrNull { it.id == descriptionId }?.text ?: "Custom text",
                    listOf("" to "Custom text") + availableDescriptions.map { it.id to it.text }) { descriptionId = it.ifEmpty { null } }
            }
            if (descriptionId == null) {
                OutlinedTextField(value = customDescription, onValueChange = { customDescription = it }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth())
            }
            OutlinedTextField(value = serial, onValueChange = { serial = it }, label = { Text("Serial Number (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DropdownField(label: String, value: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it && options.isNotEmpty() }) {
        OutlinedTextField(value = value, onValueChange = {}, readOnly = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) }, enabled = options.isNotEmpty(),
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth())
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(id); expanded = false }) }
        }
    }
}

@Composable
fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 6.dp, start = 4.dp)
    )
}

@Composable
fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun ActionRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
              tint: Color = MaterialTheme.colorScheme.primary, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = tint)
            Text(label, style = MaterialTheme.typography.bodyLarge, color = tint)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun ReturnScanSheetDialog(
    item: SKUItem,
    viewModel: AppViewModel,
    onDismiss: () -> Unit,
    onResult: (Boolean) -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var isActioning by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var scannedCode by remember { mutableStateOf<String?>(null) }
    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)

    fun executeReturn() {
        isActioning = true
        errorMessage = null
        coroutineScope.launch {
            try {
                val action = if (item.status == SKUStatus.REPAIRING) SKUAction.REPAIRED else SKUAction.RETURN_ITEM
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
                Text("Scan to Return", style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { if (!isActioning) onDismiss() }) { Text("Cancel") }
            }
            Text("Scan the QR code on the item to confirm return.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

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
                                executeReturn()
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
                    Text("Returning…")
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
fun TransferSheetDialog(
    sku: SKUItem,
    viewModel: AppViewModel,
    companies: List<com.inventoryborrowingsystem.data.Company>,
    onDismiss: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var selectedBranchId by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val transferableBranches = remember(companies, sku) {
        companies.firstOrNull { it.id == sku.warehouseId }
            ?.branches?.filter { it.id != sku.branchId } ?: emptyList()
    }

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
                Text("Transfer", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val r = reason.trim()
                            if (selectedBranchId.isEmpty() || r.isEmpty()) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    viewModel.requestTransfer(sku.displayCode, selectedBranchId, r)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && selectedBranchId.isNotEmpty() && reason.trim().isNotEmpty()
                    ) { Text(if (isSubmitting) "…" else "Submit") }
                }
            }

            if (transferableBranches.isEmpty()) {
                Text("No other branches available in this company.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = transferableBranches.firstOrNull { it.id == selectedBranchId }?.name ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Branch") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                    )
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        transferableBranches.forEach { branch ->
                            DropdownMenuItem(
                                text = { Text(branch.name) },
                                onClick = { selectedBranchId = branch.id; expanded = false }
                            )
                        }
                    }
                }
            }

            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Reason") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2
            )
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DisposalSheetDialog(sku: SKUItem, viewModel: AppViewModel, onDismiss: () -> Unit) {
    val coroutineScope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var netBookValue by remember { mutableStateOf("") }
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
                Text("Request Disposal", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val r = reason.trim(); val nbv = netBookValue.trim()
                            if (r.isEmpty() || nbv.isEmpty()) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    viewModel.requestDisposal(sku.displayCode, r, nbv)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && reason.trim().isNotEmpty() && netBookValue.trim().isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    ) { Text(if (isSubmitting) "…" else "Submit") }
                }
            }
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Reason for disposal") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3
            )
            OutlinedTextField(
                value = netBookValue,
                onValueChange = { netBookValue = it },
                label = { Text("Net book value") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal
                )
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Info, contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("This will be sent to superadmin for approval.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddSKUSheetDialog(viewModel: AppViewModel, onDismiss: () -> Unit) {
    val companies by viewModel.companies.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var selectedCompanyId by remember { mutableStateOf("") }
    var selectedBranchId by remember { mutableStateOf("") }
    var selectedLocationId by remember { mutableStateOf("") }
    var selectedCategoryId by remember { mutableStateOf("") }
    var skuSuffix by remember { mutableStateOf("") }
    var selectedDescriptionId by remember { mutableStateOf<String?>(null) }
    var customDescriptionText by remember { mutableStateOf("") }
    var serialNumber by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val selectedCompany = companies.firstOrNull { it.id == selectedCompanyId }
    val availableBranches = selectedCompany?.branches?.sortedBy { it.name } ?: emptyList()
    val selectedBranch = availableBranches.firstOrNull { it.id == selectedBranchId }
    val availableLocations = selectedBranch?.locations?.sortedBy { it.name } ?: emptyList()
    val branchHasLocations = availableLocations.isNotEmpty()
    val availableCategories = selectedCompany?.categories?.sortedBy { it.code } ?: emptyList()
    val availableDescriptions = selectedCompany?.descriptions ?: emptyList()

    val skuPreview = if (selectedCompanyId.isNotEmpty() && selectedCategoryId.isNotEmpty() && skuSuffix.length == 4) {
        val compCode = selectedCompany?.code ?: "???"
        val catCode = availableCategories.firstOrNull { it.id == selectedCategoryId }?.code ?: "???"
        "$compCode-$catCode-$skuSuffix"
    } else null

    val canSubmit = selectedCompanyId.isNotEmpty() && selectedBranchId.isNotEmpty() &&
            (!branchHasLocations || selectedLocationId.isNotEmpty()) &&
            selectedCategoryId.isNotEmpty() && skuSuffix.length == 4 &&
            (selectedDescriptionId != null || customDescriptionText.trim().isNotEmpty())

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Add Item", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            if (!canSubmit) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    val descText = if (selectedDescriptionId == null) customDescriptionText.trim().ifEmpty { null } else null
                                    val sn = serialNumber.trim().ifEmpty { null }
                                    val locId = if (selectedLocationId.isEmpty()) null else selectedLocationId
                                    viewModel.createSKU(selectedCompanyId, selectedBranchId, selectedCategoryId, locId, skuSuffix, selectedDescriptionId, descText, sn)
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && canSubmit
                    ) { Text(if (isSubmitting) "…" else "Add") }
                }
            }

            // Company picker
            var companyExpanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = companyExpanded, onExpandedChange = { companyExpanded = it }) {
                OutlinedTextField(
                    value = selectedCompany?.name ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Company") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(companyExpanded) },
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                )
                ExposedDropdownMenu(expanded = companyExpanded, onDismissRequest = { companyExpanded = false }) {
                    companies.forEach { company ->
                        DropdownMenuItem(
                            text = { Text(company.name) },
                            onClick = { selectedCompanyId = company.id; selectedBranchId = ""; selectedLocationId = ""; selectedCategoryId = ""; selectedDescriptionId = null; customDescriptionText = ""; companyExpanded = false }
                        )
                    }
                }
            }

            // Branch picker
            var branchExpanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = branchExpanded, onExpandedChange = { branchExpanded = it && availableBranches.isNotEmpty() }) {
                OutlinedTextField(
                    value = selectedBranch?.name ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Branch") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(branchExpanded) },
                    enabled = availableBranches.isNotEmpty(),
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                )
                ExposedDropdownMenu(expanded = branchExpanded, onDismissRequest = { branchExpanded = false }) {
                    availableBranches.forEach { branch ->
                        DropdownMenuItem(text = { Text(branch.name) }, onClick = { selectedBranchId = branch.id; selectedLocationId = ""; branchExpanded = false })
                    }
                }
            }

            // Location picker (only when the branch has locations)
            if (branchHasLocations) {
                var locExpanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = locExpanded, onExpandedChange = { locExpanded = it }) {
                    OutlinedTextField(
                        value = availableLocations.firstOrNull { it.id == selectedLocationId }?.name ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Location") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(locExpanded) },
                        modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                    )
                    ExposedDropdownMenu(expanded = locExpanded, onDismissRequest = { locExpanded = false }) {
                        availableLocations.forEach { loc ->
                            DropdownMenuItem(text = { Text(loc.name) }, onClick = { selectedLocationId = loc.id; locExpanded = false })
                        }
                    }
                }
            }

            // Category picker
            var catExpanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = catExpanded, onExpandedChange = { catExpanded = it && availableCategories.isNotEmpty() }) {
                OutlinedTextField(
                    value = availableCategories.firstOrNull { it.id == selectedCategoryId }?.code ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Category") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(catExpanded) },
                    enabled = availableCategories.isNotEmpty(),
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                )
                ExposedDropdownMenu(expanded = catExpanded, onDismissRequest = { catExpanded = false }) {
                    availableCategories.forEach { cat ->
                        DropdownMenuItem(text = { Text(cat.code) }, onClick = { selectedCategoryId = cat.id; catExpanded = false })
                    }
                }
            }

            OutlinedTextField(
                value = skuSuffix,
                onValueChange = { v -> skuSuffix = v.filter { it.isDigit() }.take(4) },
                label = { Text("4-digit suffix") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                singleLine = true
            )
            skuPreview?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            if (availableDescriptions.isNotEmpty()) {
                var descExpanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = descExpanded, onExpandedChange = { descExpanded = it }) {
                    OutlinedTextField(
                        value = if (selectedDescriptionId == null) "Custom text" else availableDescriptions.firstOrNull { it.id == selectedDescriptionId }?.text ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Description preset") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(descExpanded) },
                        modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                    )
                    ExposedDropdownMenu(expanded = descExpanded, onDismissRequest = { descExpanded = false }) {
                        DropdownMenuItem(text = { Text("Custom text") }, onClick = { selectedDescriptionId = null; descExpanded = false })
                        availableDescriptions.forEach { desc ->
                            DropdownMenuItem(text = { Text(desc.text) }, onClick = { selectedDescriptionId = desc.id; descExpanded = false })
                        }
                    }
                }
            }

            if (selectedDescriptionId == null) {
                OutlinedTextField(
                    value = customDescriptionText,
                    onValueChange = { customDescriptionText = it },
                    label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            }

            OutlinedTextField(
                value = serialNumber,
                onValueChange = { serialNumber = it },
                label = { Text("Serial Number (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

