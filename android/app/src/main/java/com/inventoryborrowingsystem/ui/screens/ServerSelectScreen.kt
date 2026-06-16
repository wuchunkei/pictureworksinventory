package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inventoryborrowingsystem.viewmodel.AppViewModel

/**
 * First-launch (and "change server") screen shown before login: pick the
 * recommended (fastest) node, or pin a specific one. The choice persists — see
 * AppViewModel.chooseRecommended / chooseSpecificNode.
 */
@Composable
fun ServerSelectScreen(viewModel: AppViewModel) {
    val latencies by viewModel.nodeLatencies.collectAsState()
    val measuring by viewModel.measuringNodes.collectAsState()

    LaunchedEffect(Unit) { viewModel.measureNodeLatencies() }

    fun latencyText(label: String): String {
        val v = latencies[label]
        return when {
            v != null -> "$v ms"
            latencies.containsKey(label) -> "超時"
            measuring -> "…"
            else -> ""
        }
    }

    val rec = viewModel.recommendedNode()
    val byRegion = viewModel.serverNodes.groupBy { viewModel.nodeRegion(it.label) }
    val regions = viewModel.nodeRegionOrder.filter { byRegion.containsKey(it) } +
        byRegion.keys.filter { it !in viewModel.nodeRegionOrder }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 22.dp).padding(top = 64.dp)
    ) {
        Text("选择服务器", style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold))
        Spacer(Modifier.height(6.dp))
        Text(
            "首次使用，请先选择一个服务器节点。选择「推荐」后每次都会自动使用最快的节点；选择具体节点则会固定使用它。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(20.dp))

        // Recommended option
        if (rec != null) {
            Surface(
                onClick = { viewModel.chooseRecommended() },
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(Icons.Default.Bolt, null, tint = MaterialTheme.colorScheme.onPrimary)
                    Column(Modifier.weight(1f)) {
                        Text("推荐（自动选择最快）", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.SemiBold)
                        Text(rec.label + "  " + latencyText(rec.label), color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        Text("全部节点", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 6.dp))

        LazyColumn(Modifier.weight(1f)) {
            regions.forEach { region ->
                item(key = "h_$region") {
                    Text(region, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
                }
                items(byRegion[region] ?: emptyList(), key = { it.label }) { node ->
                    val ok = viewModel.nodeSelectable(node)
                    val offline = latencies.containsKey(node.label) && latencies[node.label] == null
                    ListItem(
                        headlineContent = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(node.label, color = if (ok && !offline) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                                if (!ok) Icon(Icons.Default.Lock, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                        trailingContent = {
                            Text(if (offline) "超時" else latencyText(node.label), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        },
                        modifier = Modifier.clickable(enabled = ok && !offline) { viewModel.chooseSpecificNode(node.label) }
                    )
                }
            }
        }
    }
}
