package com.inventoryborrowingsystem.ui.screens

import android.location.Geocoder
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.ui.components.EmptyState
import com.inventoryborrowingsystem.ui.components.parseIso8601
import com.inventoryborrowingsystem.ui.components.recordColor
import com.inventoryborrowingsystem.ui.components.recordLabel
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordsScreen(viewModel: AppViewModel, navController: NavController) {
    val records by viewModel.records.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    val filteredRecords = remember(records, searchQuery) {
        if (searchQuery.isBlank()) records
        else {
            val q = searchQuery.trim().lowercase()
            records.filter { r ->
                r.skuCode?.lowercase()?.contains(q) == true ||
                r.serialNumber?.lowercase()?.contains(q) == true ||
                r.note?.lowercase()?.contains(q) == true
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Records") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
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
                    placeholder = { Text("Search by SKU or note") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    trailingIcon = { if (searchQuery.isNotEmpty()) IconButton(onClick = { searchQuery = "" }) { Icon(Icons.Default.Clear, null) } },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 2.dp),
                    singleLine = true
                )
            if (filteredRecords.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(if (searchQuery.isBlank()) "No records" else "No results", Icons.Default.DocumentScanner)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredRecords, key = { it.id }) { record ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top
                            ) {
                                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        recordLabel(record.type),
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                        color = recordColor(record.type)
                                    )
                                    Text(record.skuCode ?: "", style = MaterialTheme.typography.bodyMedium)
                                    record.serialNumber?.takeIf { it.isNotEmpty() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    record.note?.takeIf { it.isNotEmpty() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                record.createdAt?.let { dateStr ->
                                    val date = parseIso8601(dateStr)
                                    if (date != null) {
                                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(
                                                SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getDefault() }.format(date),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                            Text(
                                                SimpleDateFormat("HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getDefault() }.format(date),
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
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserLogsScreen(viewModel: AppViewModel, navController: NavController) {
    val userLogs by viewModel.userLogs.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val coroutineScope = rememberCoroutineScope()
    var searchQuery by remember { mutableStateOf("") }
    var showDateFilter by remember { mutableStateOf(false) }
    var dateFilterEnabled by remember { mutableStateOf(false) }
    val defaultStart = remember {
        Calendar.getInstance().apply { add(Calendar.MONTH, -1) }.timeInMillis
    }
    var startMs by remember { mutableStateOf(defaultStart) }
    var endMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val dateFmt = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US) }

    val filteredLogs = remember(userLogs, searchQuery, dateFilterEnabled, startMs, endMs) {
        var result = userLogs
        if (dateFilterEnabled) {
            result = result.filter { log ->
                val date = log.createdAt?.let { parseIso8601(it) } ?: return@filter false
                date.time in startMs..(endMs + 86_400_000L)
            }
        }
        if (searchQuery.isNotBlank()) {
            val q = searchQuery.trim().lowercase()
            result = result.filter { log ->
                log.actorName?.lowercase()?.contains(q) == true ||
                log.ipAddress?.lowercase()?.contains(q) == true ||
                log.message?.lowercase()?.contains(q) == true ||
                log.type.lowercase().contains(q)
            }
        }
        result
    }

    LaunchedEffect(Unit) {
        try { viewModel.fetchUserLogs() } catch (_: Exception) {}
    }

    if (showDateFilter) {
        AlertDialog(
            onDismissRequest = { showDateFilter = false },
            title = { Text("Filter by Date") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("From", style = MaterialTheme.typography.labelMedium)
                    val startState = rememberDatePickerState(initialSelectedDateMillis = startMs)
                    DatePicker(state = startState, showModeToggle = false, modifier = Modifier.fillMaxWidth())
                    Text("To", style = MaterialTheme.typography.labelMedium)
                    val endState = rememberDatePickerState(initialSelectedDateMillis = endMs)
                    DatePicker(state = endState, showModeToggle = false, modifier = Modifier.fillMaxWidth())
                    LaunchedEffect(startState.selectedDateMillis, endState.selectedDateMillis) {
                        startState.selectedDateMillis?.let { startMs = it }
                        endState.selectedDateMillis?.let { endMs = it }
                    }
                }
            },
            confirmButton = {
                Button(onClick = { dateFilterEnabled = true; showDateFilter = false }) { Text("Apply") }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (dateFilterEnabled) {
                        TextButton(onClick = { dateFilterEnabled = false; showDateFilter = false }) { Text("Clear") }
                    }
                    TextButton(onClick = { showDateFilter = false }) { Text("Cancel") }
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("User Log") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }},
                actions = {
                    IconButton(onClick = { showDateFilter = true }) {
                        Icon(
                            if (dateFilterEnabled) Icons.Default.FilterAlt else Icons.Default.FilterAltOff,
                            contentDescription = "Date filter",
                            tint = if (dateFilterEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    IconButton(onClick = {
                        coroutineScope.launch {
                            try { viewModel.fetchUserLogs() } catch (_: Exception) {}
                        }
                    }) { Icon(Icons.Default.Refresh, "Refresh") }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = { Text("Search by name or IP") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = { if (searchQuery.isNotEmpty()) IconButton(onClick = { searchQuery = "" }) { Icon(Icons.Default.Clear, null) } },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 2.dp),
                singleLine = true
            )
            if (dateFilterEnabled) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Default.CalendarMonth, null, tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp))
                    Text("${dateFmt.format(Date(startMs))}  →  ${dateFmt.format(Date(endMs))}",
                        style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { dateFilterEnabled = false },
                        contentPadding = PaddingValues(horizontal = 4.dp)) {
                        Text("Clear", color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        if (filteredLogs.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(if (searchQuery.isBlank()) "No user logs" else "No results", Icons.Default.ManageSearch)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(filteredLogs, key = { it.id }) { log ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(
                                    log.type.replace("_", " ").replaceFirstChar { it.uppercase() },
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
                                )
                                log.createdAt?.let { dateStr ->
                                    val date = parseIso8601(dateStr)
                                    if (date != null) {
                                        Text(
                                            SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).apply { timeZone = TimeZone.getDefault() }.format(date),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                            log.actorName?.let {
                                Text("By: $it (${log.actorRole ?: ""})",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            log.message?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall)
                            }
                            log.ipAddress?.takeIf { it.isNotEmpty() }?.let {
                                Text("IP: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            val g = log.geo
                            if (g?.lat != null && g.lng != null) {
                                val lat = g.lat!!; val lng = g.lng!!
                                val ctx = LocalContext.current
                                // Reverse-geocode the coordinate to a city name (when a
                                // geocoder backend is available — e.g. devices with GMS).
                                val city = rememberCityName(lat, lng)
                                Text(
                                    "📍 " + (city?.let { "$it · " } ?: "") + String.format(Locale.US, "%.5f, %.5f", lat, lng),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable {
                                        // Open the exact pin in the device's maps app.
                                        val geoUri = android.net.Uri.parse("geo:$lat,$lng?q=$lat,$lng")
                                        try {
                                            ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, geoUri))
                                        } catch (e: Exception) {
                                            ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,
                                                android.net.Uri.parse("https://maps.google.com/?q=$lat,$lng")))
                                        }
                                    }
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

/**
 * Reverse-geocode a coordinate to a "District, City" (or "City, Province") label.
 * Runs off the main thread; returns null when no geocoder backend is available
 * (e.g. China devices without Google Play services) so the row falls back to the
 * raw coordinate + map link.
 */
@Composable
private fun rememberCityName(lat: Double, lng: Double): String? {
    val ctx = LocalContext.current
    return androidx.compose.runtime.produceState<String?>(initialValue = null, lat, lng) {
        value = withContext(Dispatchers.IO) {
            try {
                if (!Geocoder.isPresent()) return@withContext null
                @Suppress("DEPRECATION")
                val addrs = Geocoder(ctx, Locale.getDefault()).getFromLocation(lat, lng, 1)
                val a = addrs?.firstOrNull() ?: return@withContext null
                listOfNotNull(a.subLocality ?: a.locality, a.adminArea ?: a.countryName)
                    .distinct().joinToString(", ").ifEmpty { null }
            } catch (e: Exception) { null }
        }
    }.value
}
