package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.SKUItem
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.ui.components.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatusScreen(viewModel: AppViewModel, navController: NavController) {
    val borrowedItems by viewModel.borrowedItems.collectAsState()
    val repairingItems by viewModel.repairingItems.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Status") }) }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refreshAsync() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            if (borrowedItems.isEmpty() && repairingItems.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState("Now you don't have anything in loan.", Icons.Default.CheckCircle)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (borrowedItems.isNotEmpty()) {
                        item {
                            Text("Borrowed", style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
                        }
                        items(borrowedItems, key = { it.id }) { item ->
                            StatusItemCard(item = item, dateKey = item.borrowedAt) {
                                navController.navigate("status_detail/${item.id}")
                            }
                        }
                    }
                    if (repairingItems.isNotEmpty()) {
                        item {
                            Spacer(Modifier.height(8.dp))
                            Text("In Repair", style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
                        }
                        items(repairingItems, key = { it.id }) { item ->
                            StatusItemCard(item = item, dateKey = item.repairStartedAt) {
                                navController.navigate("status_detail/${item.id}")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusItemCard(item: SKUItem, dateKey: String?, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SKUCard(item = item)
            dateKey?.let { dk ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.CalendarToday, contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(formatTimestamp(dk), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(elapsedTime(dk), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatusDetailScreen(viewModel: AppViewModel, skuId: String, navController: NavController) {
    val skus by viewModel.skus.collectAsState()
    val item = skus.firstOrNull { it.id == skuId }

    var showingReturnScan by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    if (item == null) {
        Scaffold(
            topBar = {
                TopAppBar(title = { Text("Status Detail") },
                    navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }})
            }
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Item not found")
            }
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(item.displayCode) },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        },
        bottomBar = {
            if (item.status == SKUStatus.BORROWED || item.status == SKUStatus.REPAIRING) {
                Surface(shadowElevation = 8.dp) {
                    Column {
                        HorizontalDivider()
                        Button(
                            onClick = { actionError = null; showingReturnScan = true },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                        ) {
                            Text(if (item.status == SKUStatus.REPAIRING) "Return from Repair" else "Return")
                        }
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) { SKUCard(item = item) }
                }
            }

            item {
                SectionHeader("Details")
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        item.companyName?.takeIf { it.isNotEmpty() }?.let { DetailRow("Company", it); HorizontalDivider() }
                        item.parkName?.takeIf { it.isNotEmpty() }?.let { DetailRow("Branch", it); HorizontalDivider() }
                        item.categoryCode?.takeIf { it.isNotEmpty() }?.let { DetailRow("Category", it); HorizontalDivider() }
                        item.serialNumber?.takeIf { it.isNotEmpty() }?.let { DetailRow("Serial", it); HorizontalDivider() }
                        item.descriptionText?.takeIf { it.isNotEmpty() }?.let { DetailRow("Description", it) }
                    }
                }
            }

            if (item.status == SKUStatus.BORROWED) {
                item.borrowedAt?.let { at ->
                    item {
                        SectionHeader("Loan")
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column {
                                DetailRow("Since", formatTimestamp(at))
                                HorizontalDivider()
                                DetailRow("Duration", elapsedTime(at))
                            }
                        }
                    }
                }
            }

            if (item.status == SKUStatus.REPAIRING) {
                item {
                    SectionHeader("Repair")
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            item.repairRequestedByName?.let { DetailRow("Submitted by", it); HorizontalDivider() }
                            item.repairStartedAt?.let { at ->
                                DetailRow("Since", formatTimestamp(at))
                                HorizontalDivider()
                                DetailRow("Duration", elapsedTime(at))
                            }
                        }
                    }
                }
            }

            actionError?.let { err ->
                item {
                    Text(err, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    if (showingReturnScan) {
        ReturnScanSheetDialog(
            item = item,
            viewModel = viewModel,
            onDismiss = { showingReturnScan = false },
            onResult = { success ->
                showingReturnScan = false
                if (!success) actionError = "QR code does not match this item."
            }
        )
    }
}
