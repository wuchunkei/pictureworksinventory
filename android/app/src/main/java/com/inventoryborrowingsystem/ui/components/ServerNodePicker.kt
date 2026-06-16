package com.inventoryborrowingsystem.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import android.widget.Toast
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.inventoryborrowingsystem.viewmodel.AppViewModel

private const val REGION_RESTRICTION_MESSAGE = "This node can't be selected due to regional protection regulations."

/**
 * Server-node selector: a button showing the current node name that opens a
 * sheet listing "Recommended" (lowest latency) + "All Nodes" with live latency.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerNodePicker(viewModel: AppViewModel, showLabel: Boolean = true) {
    val selected by viewModel.selectedNodeLabel.collectAsState()
    val latencies by viewModel.nodeLatencies.collectAsState()
    val measuring by viewModel.measuringNodes.collectAsState()
    val restricted by viewModel.nodeRestricted.collectAsState()
    val context = LocalContext.current
    var showSheet by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.syncSelectedNodeFromBaseUrl() }

    val name = selected.ifEmpty { "—" }
    if (showLabel) {
        Row(Modifier.fillMaxWidth().clickable { showSheet = true }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Server Node", Modifier.weight(1f))
            Text(name, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.Default.UnfoldMore, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        Row(Modifier.clickable { showSheet = true }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(name)
            Icon(Icons.Default.UnfoldMore, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (showSheet) {
        LaunchedEffect(Unit) { viewModel.measureNodeLatencies() }
        ModalBottomSheet(onDismissRequest = { showSheet = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
                Text("Server Node", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
                fun isOffline(label: String) = latencies.containsKey(label) && latencies[label] == null
                // Always surface a recommendation: lowest-latency reachable+selectable
                // node, else the first selectable node (so there's always one).
                val selectable = viewModel.serverNodes.filter { viewModel.nodeSelectable(it) }
                val reachable = selectable.filter { !isOffline(it.label) }
                val measured = reachable.filter { latencies[it.label] != null }
                val recNode = measured.minByOrNull { latencies[it.label] ?: Int.MAX_VALUE }
                    ?: reachable.firstOrNull() ?: selectable.firstOrNull()
                if (recNode != null) {
                    Text("Recommended", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    NodeRow(recNode.label, latencyText(latencies[recNode.label], measuring), selected == recNode.label, true, false) {
                        viewModel.selectServerNode(recNode.label); showSheet = false
                    }
                    HorizontalDivider(Modifier.padding(vertical = 4.dp))
                }
                // All nodes grouped by country/region.
                val byRegion = viewModel.serverNodes.groupBy { viewModel.nodeRegion(it.label) }
                val regions = viewModel.nodeRegionOrder.filter { byRegion.containsKey(it) } +
                    byRegion.keys.filter { it !in viewModel.nodeRegionOrder }
                LazyColumn(Modifier.heightIn(max = 400.dp)) {
                    regions.forEach { region ->
                        item(key = "hdr_$region") {
                            Text(region, style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
                        }
                        items(byRegion[region] ?: emptyList(), key = { it.label }) { node ->
                            val regionOk = viewModel.nodeSelectable(node)
                            val offline = isOffline(node.label)
                            val enabled = regionOk && !offline
                            val display = if (offline) "超時" else latencyText(latencies[node.label], measuring)
                            NodeRow(node.label, display, selected == node.label, enabled, !regionOk) {
                                when {
                                    !regionOk -> Toast.makeText(context, REGION_RESTRICTION_MESSAGE, Toast.LENGTH_SHORT).show()
                                    offline -> Toast.makeText(context, "This node is unreachable right now.", Toast.LENGTH_SHORT).show()
                                    else -> { viewModel.selectServerNode(node.label); showSheet = false }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun latencyText(value: Int?, measuring: Boolean): String = when {
    value == null && measuring -> "…"
    value == null -> ""
    else -> "$value ms"
}

@Composable
private fun NodeRow(label: String, latency: String, isSelected: Boolean, enabled: Boolean, locked: Boolean, onClick: () -> Unit) {
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    ListItem(
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label, color = if (enabled) MaterialTheme.colorScheme.onSurface else dim)
                if (locked) Icon(Icons.Default.Lock, null, Modifier.size(14.dp), tint = dim)
            }
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (latency.isNotEmpty()) Text(latency, style = MaterialTheme.typography.bodySmall, color = dim)
                if (isSelected) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.primary)
            }
        },
        modifier = Modifier.clickable { onClick() }
    )
}
