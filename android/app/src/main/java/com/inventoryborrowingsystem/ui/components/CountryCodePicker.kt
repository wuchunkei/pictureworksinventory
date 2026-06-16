package com.inventoryborrowingsystem.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.inventoryborrowingsystem.data.CountryCodes

@Composable
fun CountryCodePickerDialog(
    selected: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var search by remember { mutableStateOf("") }

    val filteredAll = remember(search) {
        val q = search.trim().lowercase()
        if (q.isEmpty()) CountryCodes.all
        else CountryCodes.all.filter {
            it.label.lowercase().contains(q) || it.code.contains(q)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .fillMaxHeight(0.85f),
            shape = MaterialTheme.shapes.large,
            tonalElevation = 6.dp
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Country Code", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                }

                // Search
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    placeholder = { Text("Search country or code") },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = {
                        if (search.isNotEmpty())
                            IconButton(onClick = { search = "" }) { Icon(Icons.Default.Clear, null) }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    singleLine = true
                )

                Spacer(Modifier.height(8.dp))

                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    if (search.isBlank()) {
                        item {
                            Text(
                                "Recommended",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                            )
                        }
                        items(CountryCodes.recommended, key = { it.label }) { entry ->
                            CountryRow(entry.code, entry.flag, entry.label, selected) {
                                onSelect(entry.code); onDismiss()
                            }
                        }
                        item { HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp)) }
                        item {
                            Text(
                                "All Countries",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                            )
                        }
                    }
                    items(filteredAll, key = { it.label }) { entry ->
                        CountryRow(entry.code, entry.flag, entry.label, selected) {
                            onSelect(entry.code); onDismiss()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CountryRow(
    code: String,
    flag: String,
    label: String,
    selected: String,
    onClick: () -> Unit
) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(flag, style = MaterialTheme.typography.titleMedium)
            Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Text(code, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (selected == code) {
                Icon(Icons.Default.Check, null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp))
            } else {
                Spacer(Modifier.size(16.dp))
            }
        }
    }
}
