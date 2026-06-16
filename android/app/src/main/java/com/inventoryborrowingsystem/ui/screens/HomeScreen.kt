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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.ui.components.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(viewModel: AppViewModel, navController: NavController) {
    val currentUser by viewModel.currentUser.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val borrowedItems by viewModel.borrowedItems.collectAsState()
    val records by viewModel.records.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val userLogs by viewModel.userLogs.collectAsState()

    val availableCount = skus.count { it.status == SKUStatus.AVAILABLE }
    val repairingCount = skus.count { it.status == SKUStatus.REPAIRING }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Home") })
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refreshAsync() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Profile card
                if (currentUser != null) {
                    item {
                        GlassPanel {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text(currentUser!!.name, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
                                        Text(currentUser!!.role.displayName,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Icon(Icons.Default.Badge, contentDescription = null,
                                        modifier = Modifier.size(32.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                                ) {
                                    MetricCard("Borrowed", "${borrowedItems.size}", Modifier.weight(1f))
                                    MetricCard("Available", "$availableCount", Modifier.weight(1f))
                                    MetricCard("Repairing", "$repairingCount", Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }

                // Work section
                item {
                    Text("Work", style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp))
                }

                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            NavigationItem(
                                label = "Recent Activity",
                                icon = Icons.Default.History,
                                onClick = { navController.navigate("recent_activity") }
                            )
                            if (currentUser?.role?.canSeeManagementShortcuts == true) {
                                HorizontalDivider()
                                NavigationItem(
                                    label = "Inventory",
                                    icon = Icons.Default.Inventory2,
                                    onClick = { navController.navigate("inventory") }
                                )
                                HorizontalDivider()
                                NavigationItem(
                                    label = "Company",
                                    icon = Icons.Default.Business,
                                    onClick = { navController.navigate("companies") }
                                )
                                HorizontalDivider()
                                NavigationItem(
                                    label = "Category",
                                    icon = Icons.Default.Label,
                                    onClick = { navController.navigate("categories") }
                                )
                                HorizontalDivider()
                                NavigationItem(
                                    label = "Records",
                                    icon = Icons.Default.DocumentScanner,
                                    onClick = { navController.navigate("records") }
                                )
                                HorizontalDivider()
                                NavigationItem(
                                    label = "Users",
                                    icon = Icons.Default.Group,
                                    onClick = { navController.navigate("users") }
                                )
                            }
                            if (permissions?.canViewUserLogs == true) {
                                HorizontalDivider()
                                NavigationItem(
                                    label = "User Log",
                                    icon = Icons.Default.ManageSearch,
                                    onClick = { navController.navigate("user_logs") }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricCard(title: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(value, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
        Text(title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun NavigationItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Icon(Icons.Default.ChevronRight, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecentActivityScreen(viewModel: AppViewModel, navController: NavController) {
    val records by viewModel.records.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    var showDateFilter by remember { mutableStateOf(false) }
    var filterEnabled by remember { mutableStateOf(false) }
    // Use Calendar for default start (1 month ago)
    val defaultStart = remember {
        Calendar.getInstance().apply { add(Calendar.MONTH, -1) }.timeInMillis
    }
    var startMs by remember { mutableStateOf(defaultStart) }
    var endMs by remember { mutableStateOf(System.currentTimeMillis()) }

    val filteredRecords = remember(records, filterEnabled, startMs, endMs) {
        if (!filterEnabled) records.take(100)
        else records.filter { record ->
            val date = record.createdAt?.let { parseIso8601(it) } ?: return@filter false
            date.time in startMs..(endMs + 86_400_000L)
        }
    }

    val dateFmt = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US) }

    if (showDateFilter) {
        AlertDialog(
            onDismissRequest = { showDateFilter = false },
            title = { Text("Filter by Date") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("From", style = MaterialTheme.typography.labelMedium)
                    val startState = rememberDatePickerState(initialSelectedDateMillis = startMs)
                    DatePicker(state = startState, showModeToggle = false,
                        modifier = Modifier.fillMaxWidth())
                    Text("To", style = MaterialTheme.typography.labelMedium)
                    val endState = rememberDatePickerState(initialSelectedDateMillis = endMs)
                    DatePicker(state = endState, showModeToggle = false,
                        modifier = Modifier.fillMaxWidth())
                    LaunchedEffect(startState.selectedDateMillis, endState.selectedDateMillis) {
                        startState.selectedDateMillis?.let { startMs = it }
                        endState.selectedDateMillis?.let { endMs = it }
                    }
                }
            },
            confirmButton = {
                Button(onClick = { filterEnabled = true; showDateFilter = false }) { Text("Apply") }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (filterEnabled) {
                        TextButton(onClick = { filterEnabled = false; showDateFilter = false }) { Text("Clear") }
                    }
                    TextButton(onClick = { showDateFilter = false }) { Text("Cancel") }
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Recent Activity") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showDateFilter = true }) {
                        Icon(
                            if (filterEnabled) Icons.Default.FilterAlt else Icons.Default.FilterAltOff,
                            contentDescription = "Date filter",
                            tint = if (filterEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
        if (filterEnabled) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Default.CalendarMonth, null, tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp))
                Text("${dateFmt.format(Date(startMs))}  →  ${dateFmt.format(Date(endMs))}",
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { filterEnabled = false },
                    contentPadding = PaddingValues(horizontal = 4.dp)) {
                    Text("Clear", color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (filteredRecords.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(if (filterEnabled) "No activity in range" else "No recent activity", Icons.Default.History)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(filteredRecords) { record ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Top
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = (if (record.type == "return_after_repair") "REPAIRED" else record.type).uppercase(),
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = recordColor(record.type)
                                )
                                Text(record.skuCode ?: "", style = MaterialTheme.typography.bodyMedium)
                            }
                            record.createdAt?.let { dateStr ->
                                val date = parseIso8601(dateStr)
                                if (date != null) {
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            SimpleDateFormat("yyyy-MM-dd", Locale.US).format(date),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        Text(
                                            SimpleDateFormat("HH:mm:ss", Locale.US).format(date),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        }
    }
}
