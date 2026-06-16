package com.inventoryborrowingsystem.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inventoryborrowingsystem.data.ImportDiff
import com.inventoryborrowingsystem.data.ImportMismatch
import com.inventoryborrowingsystem.data.ImportNewItem
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch

/**
 * Import an exported Asset Check Form: pick company + branch + file → server diffs
 * it against inventory into New / Mismatched / Already-correct → pick what to apply.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportACFSheet(viewModel: AppViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val companies by viewModel.companies.collectAsState()
    val scope = rememberCoroutineScope()

    var companyId by remember { mutableStateOf("") }
    var branchId by remember { mutableStateOf("") }
    var fileUri by remember { mutableStateOf<Uri?>(null) }
    var fileName by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var diff by remember { mutableStateOf<ImportDiff?>(null) }

    val createSel = remember { mutableStateMapOf<String, Boolean>() }   // assetId
    val updateSel = remember { mutableStateMapOf<String, Boolean>() }   // skuId
    // Per-remark placement keyed by "assetId|remark": active, target branch, location.
    val placeActive = remember { mutableStateMapOf<String, Boolean>() }
    val placeBranch = remember { mutableStateMapOf<String, String>() }
    val placeLocation = remember { mutableStateMapOf<String, String>() }

    val company = companies.firstOrNull { it.id == companyId }
    val branches = company?.branches?.sortedBy { it.name } ?: emptyList()
    val canAnalyze = companyId.isNotEmpty() && branchId.isNotEmpty() && fileUri != null && !working

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            fileUri = uri
            fileName = queryName(context, uri)
            error = null
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!working) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val d = diff
            if (d == null) {
                Text("Import Asset Form", style = MaterialTheme.typography.titleLarge)
                DropdownField("Company", company?.name ?: "", companies.map { it.id to it.name }) { companyId = it; branchId = "" }
                DropdownField("Branch", branches.firstOrNull { it.id == branchId }?.name ?: "", branches.map { it.id to it.name }) { branchId = it }
                OutlinedButton(onClick = { picker.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (fileName.isEmpty()) "Choose Asset Check Form (.xlsx)" else fileName, maxLines = 1)
                }
                Text("Each ASSET ID is matched against your inventory; we'll show what's new, what differs, and what already matches.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { if (!working) onDismiss() }) { Text("Cancel") }
                    Button(enabled = canAnalyze, onClick = {
                        working = true; error = null
                        scope.launch {
                            try {
                                val res = viewModel.importParse(context, fileUri!!, companyId, branchId)
                                createSel.clear(); res.newItems.forEach { createSel[it.assetId] = true }
                                updateSel.clear(); res.mismatched.forEach { updateSel[it.skuId] = true }
                                // Default unselected — the user opts in and picks
                                // branch (+ location if any), like Add-Inventory.
                                placeActive.clear(); placeBranch.clear(); placeLocation.clear()
                                res.remarks.forEach { rm ->
                                    val k = rm.assetId + "|" + rm.remark
                                    placeActive[k] = false
                                    placeBranch[k] = ""
                                    placeLocation[k] = ""
                                }
                                diff = res
                            } catch (e: Exception) { error = e.message } finally { working = false }
                        }
                    }) { Text(if (working) "…" else "Analyze") }
                }
            } else {
                Text("Review Import", style = MaterialTheme.typography.titleLarge)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    CountPill("New", d.counts.new, Color(0xFF1B873F))
                    CountPill("Mismatched", d.counts.mismatched, Color(0xFFE08600))
                    CountPill("Correct", d.counts.existing, Color(0xFF0071E3))
                }
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (d.newItems.isNotEmpty()) {
                        item { SectionLabel("New — will be created") }
                        items(d.newItems, key = { it.assetId }) { item ->
                            ImportToggleRow(checked = createSel[item.assetId] == true, onToggle = { createSel[item.assetId] = it }) {
                                Text(item.assetId, fontWeight = FontWeight.SemiBold)
                                val sub = listOfNotNull(item.description.ifEmpty { null }, item.serial.ifEmpty { null }?.let { "SN: $it" }, item.location.ifEmpty { null }).joinToString(" · ")
                                if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (d.mismatched.isNotEmpty()) {
                        item { SectionLabel("Mismatched — will be updated") }
                        items(d.mismatched, key = { it.skuId }) { item ->
                            ImportToggleRow(checked = updateSel[item.skuId] == true, onToggle = { updateSel[item.skuId] = it }) {
                                Text(item.assetId, fontWeight = FontWeight.SemiBold)
                                item.diffs.forEach { df ->
                                    Text("${df.field}: ${df.current.ifEmpty { "—" }} → ${df.imported.ifEmpty { "—" }}",
                                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                    if (d.newLocations.isNotEmpty()) {
                        item { SectionLabel("New locations — will be created (${d.newLocations.size})") }
                        item { Text(d.newLocations.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    if (d.existing.isNotEmpty()) {
                        item { SectionLabel("Already correct (${d.existing.size}) — no change") }
                        item { Text(d.existing.joinToString(", ") { it.assetId }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    if (d.newItems.isEmpty() && d.mismatched.isEmpty()) {
                        item { Text("Everything already matches — nothing to import.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    // Remarks (your column-J notes, e.g. "To OW") at the very bottom.
                    // Each can be placed: existing → transfer; new → assign branch/location.
                    if (d.remarks.isNotEmpty()) {
                        item { SectionLabel("⚑ Remarks — needs attention (${d.remarks.size})") }
                        items(d.remarks, key = { it.assetId + "|" + it.remark }) { rm ->
                            val k = rm.assetId + "|" + rm.remark
                            val existing = rm.skuId != null
                            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(rm.assetId, fontWeight = FontWeight.SemiBold)
                                    Spacer(Modifier.width(6.dp))
                                    Text(if (existing) "existing" else "not in inventory",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (existing) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFFE08600))
                                }
                                Text(rm.remark, color = Color(0xFFE08600))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = placeActive[k] == true, onCheckedChange = { placeActive[k] = it })
                                    Text(if (existing) "Transfer to another branch / location" else "Assign branch / location",
                                        style = MaterialTheme.typography.bodySmall)
                                }
                                if (placeActive[k] == true) {
                                    DropdownField(if (existing) "Transfer to branch" else "Branch",
                                        branches.firstOrNull { it.id == placeBranch[k] }?.name ?: "Not selected",
                                        branches.map { it.id to it.name }) { placeBranch[k] = it; placeLocation[k] = "" }
                                    val locs = branches.firstOrNull { it.id == placeBranch[k] }?.locations
                                        ?.sortedBy { it.name } ?: emptyList()
                                    if (locs.isNotEmpty()) {
                                        DropdownField("Location",
                                            (placeLocation[k] ?: "").ifEmpty { "Not selected" },
                                            locs.map { it.name to it.name }) { placeLocation[k] = it }
                                    }
                                }
                            }
                        }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                // All active placements must have a branch (+ a location if that branch has any).
                val placementsComplete = d.remarks.all { rm ->
                    val k = rm.assetId + "|" + rm.remark
                    if (placeActive[k] != true) true
                    else {
                        val br = placeBranch[k]
                        if (br.isNullOrEmpty()) false
                        else {
                            val locs = branches.firstOrNull { it.id == br }?.locations ?: emptyList()
                            !(locs.isNotEmpty() && (placeLocation[k] ?: "").isEmpty())
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    OutlinedButton(onClick = { diff = null }) { Text("Back") }
                    Button(enabled = !working && placementsComplete && (createSel.values.any { it } || updateSel.values.any { it } || placeActive.values.any { it }), onClick = {
                        working = true; error = null
                        scope.launch {
                            try {
                                val create = d.newItems.filter { createSel[it.assetId] == true }
                                val update = d.mismatched.filter { updateSel[it.skuId] == true }
                                val place = d.remarks.mapNotNull { rm ->
                                    val k = rm.assetId + "|" + rm.remark
                                    val br = placeBranch[k]
                                    if (placeActive[k] == true && !br.isNullOrEmpty()) {
                                        val m = mutableMapOf<String, Any>(
                                            "assetId" to rm.assetId, "branchId" to br,
                                            "location" to (placeLocation[k] ?: ""),
                                            "description" to rm.description, "serial" to rm.serial
                                        )
                                        rm.skuId?.let { m["skuId"] = it }
                                        m
                                    } else null
                                }
                                viewModel.importApply(companyId, branchId, create, update, place)
                                onDismiss()
                            } catch (e: Exception) { error = e.message } finally { working = false }
                        }
                    }) { Text(if (working) "…" else "Apply") }
                }
            }
        }
    }
}

@Composable
private fun RowScope.CountPill(label: String, n: Int, color: Color) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
}

@Composable
private fun ImportToggleRow(checked: Boolean, onToggle: (Boolean) -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        IconButton(onClick = { onToggle(!checked) }, modifier = Modifier.size(28.dp)) {
            Icon(if (checked) Icons.Default.CheckCircle else Icons.Outlined.Circle, contentDescription = null,
                tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) { content() }
    }
}

private fun queryName(context: android.content.Context, uri: Uri): String {
    return try {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else "Selected file"
        } ?: "Selected file"
    } catch (e: Exception) { "Selected file" }
}
