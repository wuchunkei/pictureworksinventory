package com.inventoryborrowingsystem.ui.screens

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.border
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.AssetCheckFormRow
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.ui.components.SignaturePad
import com.inventoryborrowingsystem.ui.components.rememberSignatureState
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch
import java.io.File

// MARK: - Download + share

fun shareAcfFile(context: Context, bytes: ByteArray, filename: String) {
    val dir = File(context.cacheDir, "acf").apply { mkdirs() }
    val file = File(dir, filename)
    file.writeBytes(bytes)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val mime = when {
        filename.endsWith(".pdf") -> "application/pdf"
        filename.endsWith(".zip") -> "application/zip"
        else -> "application/octet-stream"
    }
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Share $filename"))
}

fun acfCategory(assetId: String): String {
    val parts = assetId.split("-")
    return if (parts.size >= 3) parts[parts.size - 2] else "—"
}

fun acfNumber(assetId: String): Int = assetId.substringAfterLast("-", "").filter { it.isDigit() }.toIntOrNull() ?: 0

// MARK: - Export sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExportACFSheet(viewModel: AppViewModel, onDismiss: () -> Unit) {
    val companies by viewModel.companies.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val scope = rememberCoroutineScope()
    val sig = rememberSignatureState()
    var sigVersion by remember { mutableStateOf(0) }

    var companyId by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var fileName by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val company = companies.firstOrNull { it.id == companyId }
    val availableBranches = company?.branches?.sortedBy { it.name } ?: emptyList()
    val branch = availableBranches.firstOrNull { it.id == branchId }
    val included = if (companyId.isNotEmpty() && branchId.isNotEmpty())
        skus.filter { it.warehouseId == companyId && it.branchId == branchId &&
            (it.status == SKUStatus.AVAILABLE || it.status == SKUStatus.BORROWED || it.status == SKUStatus.REPAIRING) }
    else emptyList()
    val hasEndorser = !(branch?.endorserUserId.isNullOrEmpty())
    val hasSignature = run { sigVersion; !sig.isEmpty }
    val canSubmit = companyId.isNotEmpty() && branchId.isNotEmpty() && fileName.trim().isNotEmpty() &&
            included.isNotEmpty() && hasEndorser && hasSignature

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Export Asset Form", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(onClick = {
                        val png = sig.toBase64Png() ?: return@Button
                        isSubmitting = true
                        scope.launch {
                            try { viewModel.createAssetCheckForm(companyId, branchId, fileName.trim(), png); onDismiss() }
                            catch (e: Exception) { error = e.message } finally { isSubmitting = false }
                        }
                    }, enabled = !isSubmitting && canSubmit) { Text(if (isSubmitting) "…" else "Submit") }
                }
            }
            DropdownField("Company", company?.name ?: "", companies.map { it.id to it.name }) { companyId = it; branchId = "" }
            DropdownField("Branch", branch?.name ?: "", availableBranches.map { it.id to it.name }) { branchId = it }
            if (branchId.isNotEmpty()) {
                Row(Modifier.fillMaxWidth()) {
                    Text("Assets to include", Modifier.weight(1f))
                    Text("${included.size}", color = if (included.isEmpty()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(Modifier.fillMaxWidth()) {
                    Text("Endorser", Modifier.weight(1f))
                    Text(branch?.endorserName ?: "Not set", color = if (hasEndorser) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFFE08600))
                }
            }
            OutlinedTextField(value = fileName, onValueChange = { fileName = it }, label = { Text("File name") },
                trailingIcon = { Text(".pdf", color = MaterialTheme.colorScheme.onSurfaceVariant) }, singleLine = true, modifier = Modifier.fillMaxWidth())

            Text("Your signature", style = MaterialTheme.typography.labelMedium)
            Box(Modifier.fillMaxWidth().height(160.dp).border(1.dp, androidx.compose.ui.graphics.Color(0x33888888), RoundedCornerShape(8.dp))) {
                SignaturePad(sig, onChange = { sigVersion++ })
                if (!hasSignature) Text("Sign here", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row {
                TextButton(onClick = { sig.clear(); sigVersion++ }, enabled = hasSignature) { Text("Clear") }
            }
            if (branchId.isNotEmpty() && !hasEndorser)
                Text("This branch has no endorser. Set one in the branch settings before exporting.", color = Color(0xFFE08600), style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

// MARK: - Asset list (filterable)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ACFAssetListScreen(rows: List<AssetCheckFormRow>, onBack: () -> Unit) {
    var category by remember { mutableStateOf("All") }
    val categories = remember(rows) { listOf("All") + rows.map { acfCategory(it.assetId) }.toSortedSet().toList() }
    val displayed = remember(rows, category) {
        if (category == "All") rows.sortedWith(compareBy({ it.assetId }))
        else rows.filter { acfCategory(it.assetId) == category }.sortedBy { acfNumber(it.assetId) }
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text("${displayed.size} Assets") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } }) }
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(categories) { cat ->
                        FilterChip(selected = category == cat, onClick = { category = cat }, label = { Text(cat) })
                    }
                }
            }
            items(displayed, key = { it.no }) { r ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text(r.assetId, style = MaterialTheme.typography.titleMedium)
                        if (r.description.isNotEmpty()) Text(r.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(buildString {
                            if (r.found.isNotEmpty()) append("Found: ${r.found}")
                            if (r.checkedBy.isNotEmpty()) { if (isNotEmpty()) append(" · "); append("By: ${r.checkedBy}") }
                        }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

// MARK: - Resubmit screen (denied/withdrawn → edit + re-sign)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ACFResubmitScreen(viewModel: AppViewModel, formId: String, navController: NavController) {
    val companies by viewModel.companies.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val scope = rememberCoroutineScope()
    val sig = rememberSignatureState()
    var sigVersion by remember { mutableStateOf(0) }

    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var denyReason by remember { mutableStateOf<String?>(null) }
    var companyId by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var fileName by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<AssetCheckFormRow>>(emptyList()) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAssets by remember { mutableStateOf(false) }

    LaunchedEffect(formId) {
        try {
            val f = viewModel.getAssetCheckForm(formId)
            companyId = f.companyId ?: ""; branchId = f.branchId ?: ""; fileName = f.acfNo
            rows = f.rows ?: emptyList(); denyReason = f.denyReason
        } catch (e: Exception) { loadError = e.message }
        loading = false
    }

    val company = companies.firstOrNull { it.id == companyId }
    val availableBranches = company?.branches?.sortedBy { it.name } ?: emptyList()
    val branch = availableBranches.firstOrNull { it.id == branchId }
    val included = skus.filter { it.warehouseId == companyId && it.branchId == branchId &&
        (it.status == SKUStatus.AVAILABLE || it.status == SKUStatus.BORROWED || it.status == SKUStatus.REPAIRING) }
    val hasEndorser = !(branch?.endorserUserId.isNullOrEmpty())
    val hasSignature = run { sigVersion; !sig.isEmpty }
    val canSubmit = companyId.isNotEmpty() && branchId.isNotEmpty() && fileName.trim().isNotEmpty() && included.isNotEmpty() && hasEndorser && hasSignature

    if (showAssets) { ACFAssetListScreen(rows) { showAssets = false }; return }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Review & Resubmit") }, navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } },
                actions = {
                    if (submitting) CircularProgressIndicator(Modifier.size(24.dp))
                    else TextButton(onClick = {
                        val png = sig.toBase64Png() ?: return@TextButton
                        submitting = true
                        scope.launch {
                            try { viewModel.resubmitAssetCheckForm(formId, companyId, branchId, fileName.trim(), png); navController.popBackStack() }
                            catch (e: Exception) { error = e.message } finally { submitting = false }
                        }
                    }, enabled = canSubmit) { Text("Resubmit") }
                })
        }
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            loadError != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text(loadError!!, color = MaterialTheme.colorScheme.error) }
            else -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                denyReason?.takeIf { it.isNotEmpty() }?.let {
                    Text("Denied reason", style = MaterialTheme.typography.labelMedium)
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                DropdownField("Company", company?.name ?: "", companies.map { it.id to it.name }) { companyId = it; branchId = "" }
                DropdownField("Branch", branch?.name ?: "", availableBranches.map { it.id to it.name }) { branchId = it }
                Row(Modifier.fillMaxWidth()) { Text("Assets to include", Modifier.weight(1f)); Text("${included.size}") }
                Row(Modifier.fillMaxWidth()) { Text("Endorser", Modifier.weight(1f)); Text(branch?.endorserName ?: "Not set", color = if (hasEndorser) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFFE08600)) }
                OutlinedTextField(value = fileName, onValueChange = { fileName = it }, label = { Text("File name") }, trailingIcon = { Text(".pdf") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (rows.isNotEmpty()) {
                    Text("Assets in this form (${rows.size})", style = MaterialTheme.typography.labelMedium)
                    rows.take(3).forEach { r -> Text("${r.assetId}  ${r.description}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (rows.size > 3) TextButton(onClick = { showAssets = true }) { Text("View all ${rows.size} assets") }
                }
                Text("Your signature", style = MaterialTheme.typography.labelMedium)
                Box(Modifier.fillMaxWidth().height(160.dp).border(1.dp, androidx.compose.ui.graphics.Color(0x33888888), RoundedCornerShape(8.dp))) {
                    SignaturePad(sig, onChange = { sigVersion++ })
                    if (!hasSignature) Text("Sign here", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { sig.clear(); sigVersion++ }, enabled = hasSignature) { Text("Clear") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
