package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.inventoryborrowingsystem.data.*
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch

// MARK: - Companies

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompaniesScreen(viewModel: AppViewModel, navController: NavController) {
    val companies by viewModel.companies.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<Company?>(null) }
    var pendingDelete by remember { mutableStateOf<Company?>(null) }
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Company") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { editTarget = null; showForm = true }) { Icon(Icons.Default.Add, "Add") } }
            )
        }
    ) { padding ->
        if (companies.isEmpty()) {
            EmptyState(padding, Icons.Default.Business, "No companies yet")
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(companies, key = { it.id }) { company ->
                    Card(onClick = { navController.navigate("branches/${company.id}") }, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(company.name, style = MaterialTheme.typography.titleMedium)
                                Text("${company.code} · ${company.branches.size} branch(es)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { editTarget = company; showForm = true }) { Icon(Icons.Default.Edit, "Edit") }
                            IconButton(onClick = { pendingDelete = company }) { Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error) }
                            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }

    if (showForm) {
        CompanyFormDialog(existing = editTarget, onSave = { name, code ->
            scope.launch {
                try {
                    if (editTarget == null) viewModel.createCompany(name, code) else viewModel.updateCompany(editTarget!!.id, name, code)
                    showForm = false
                } catch (e: Exception) { error = e.message }
            }
        }, onCancel = { showForm = false })
    }
    pendingDelete?.let { c ->
        ConfirmDialog("Delete \"${c.name}\"?", "This deletes the company and all its branches, locations and categories. This cannot be undone.", "Delete", onConfirm = {
            scope.launch { try { viewModel.deleteCompany(c.id) } catch (e: Exception) { error = e.message }; pendingDelete = null }
        }, onCancel = { pendingDelete = null })
    }
    error?.let { ErrorDialog(it) { error = null } }
}

@Composable
private fun CompanyFormDialog(existing: Company?, onSave: (String, String) -> Unit, onCancel: () -> Unit) {
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var code by remember { mutableStateOf(existing?.code ?: "") }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(if (existing == null) "New Company" else "Edit Company") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true)
                OutlinedTextField(value = code, onValueChange = { code = it.uppercase() }, label = { Text("Short code (e.g. PWBJ)") }, singleLine = true)
            }
        },
        confirmButton = { TextButton(onClick = { if (name.isNotBlank() && code.isNotBlank()) onSave(name.trim(), code.trim()) }, enabled = name.isNotBlank() && code.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
}

// MARK: - Branches

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BranchListScreen(viewModel: AppViewModel, navController: NavController, companyId: String) {
    val companies by viewModel.companies.collectAsState()
    val company = companies.firstOrNull { it.id == companyId }
    val branches = company?.branches?.sortedBy { it.name } ?: emptyList()
    var showForm by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<Park?>(null) }
    var pendingDelete by remember { mutableStateOf<Park?>(null) }
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(company?.name ?: "Branches") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { editTarget = null; showForm = true }) { Icon(Icons.Default.Add, "Add") } }
            )
        }
    ) { padding ->
        if (branches.isEmpty()) EmptyState(padding, Icons.Default.Apartment, "No branches yet")
        else LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(branches, key = { it.id }) { branch ->
                Card(onClick = { navController.navigate("locations/$companyId/${branch.id}") }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(branch.name, style = MaterialTheme.typography.titleMedium)
                            val locs = branch.locations ?: emptyList()
                            val endorser = branch.endorserName
                            Text(buildString {
                                if (locs.isNotEmpty()) append("${locs.size} location(s)")
                                if (!endorser.isNullOrEmpty()) { if (isNotEmpty()) append(" · "); append("Endorser: $endorser") }
                            }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = { editTarget = branch; showForm = true }) { Icon(Icons.Default.Edit, "Edit") }
                        IconButton(onClick = { pendingDelete = branch }) { Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error) }
                        Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    if (showForm) {
        BranchFormDialog(viewModel = viewModel, existing = editTarget, onSave = { name, endorserId ->
            scope.launch {
                try {
                    if (editTarget == null) viewModel.addBranch(companyId, name, endorserId)
                    else viewModel.updateBranch(companyId, editTarget!!.id, name, endorserId)
                    showForm = false
                } catch (e: Exception) { error = e.message }
            }
        }, onCancel = { showForm = false })
    }
    pendingDelete?.let { b ->
        ConfirmDialog("Delete \"${b.name}\"?", "This action cannot be undone.", "Delete", onConfirm = {
            scope.launch { try { viewModel.deleteBranch(companyId, b.id) } catch (e: Exception) { error = e.message }; pendingDelete = null }
        }, onCancel = { pendingDelete = null })
    }
    error?.let { ErrorDialog(it) { error = null } }
}

@Composable
private fun BranchFormDialog(viewModel: AppViewModel, existing: Park?, onSave: (String, String?) -> Unit, onCancel: () -> Unit) {
    val users by viewModel.users.collectAsState()
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var endorserId by remember { mutableStateOf(existing?.endorserUserId) }
    var showEndorserPicker by remember { mutableStateOf(false) }
    val endorserName = users.firstOrNull { it.id == endorserId }?.name ?: existing?.endorserName

    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(if (existing == null) "New Branch" else "Edit Branch") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Branch name") }, singleLine = true)
                Card(onClick = { showEndorserPicker = true }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Endorser", Modifier.weight(1f))
                        Text(endorserName ?: "None", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Text("The person who signs this branch's Asset Check Form. Must be an existing user.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = { if (name.isNotBlank()) onSave(name.trim(), endorserId) }, enabled = name.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
    if (showEndorserPicker) {
        EndorserPickerDialog(users, endorserId, onPick = { endorserId = it; showEndorserPicker = false }, onCancel = { showEndorserPicker = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EndorserPickerDialog(users: List<User>, selectedId: String?, onPick: (String?) -> Unit, onCancel: () -> Unit) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(search, users) {
        val q = search.trim().lowercase()
        val sorted = users.sortedBy { it.name }
        if (q.isEmpty()) sorted else sorted.filter { it.name.lowercase().contains(q) || (it.phone ?: "").contains(q) || it.username.lowercase().contains(q) }
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Endorser") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Search by name or phone") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    item {
                        ListItem(headlineContent = { Text("None") },
                            trailingContent = { if (selectedId == null) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.clickable { onPick(null) })
                    }
                    items(filtered, key = { it.id }) { u ->
                        ListItem(
                            headlineContent = { Text(u.name) },
                            supportingContent = { Text(u.role.displayName) },
                            trailingContent = { if (selectedId == u.id) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.clickable { onPick(u.id) }
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
}

// MARK: - Locations

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationListScreen(viewModel: AppViewModel, navController: NavController, companyId: String, branchId: String) {
    val companies by viewModel.companies.collectAsState()
    val branch = companies.firstOrNull { it.id == companyId }?.branches?.firstOrNull { it.id == branchId }
    val locations = branch?.locations?.sortedBy { it.name } ?: emptyList()
    var showForm by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<StockLocation?>(null) }
    var pendingDelete by remember { mutableStateOf<StockLocation?>(null) }
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(branch?.name ?: "Locations") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { editTarget = null; showForm = true }) { Icon(Icons.Default.Add, "Add") } }
            )
        }
    ) { padding ->
        if (locations.isEmpty()) EmptyState(padding, Icons.Default.Place, "No locations yet")
        else LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(locations, key = { it.id }) { loc ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(loc.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        IconButton(onClick = { editTarget = loc; showForm = true }) { Icon(Icons.Default.Edit, "Edit") }
                        IconButton(onClick = { pendingDelete = loc }) { Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }

    if (showForm) {
        NameFormDialog(
            title = if (editTarget == null) "New Location" else "Edit Location",
            label = "Name (e.g. Shelf A1)",
            initial = editTarget?.name ?: "",
            onSave = { newName ->
                scope.launch {
                    try {
                        if (editTarget == null) viewModel.addLocation(companyId, branchId, newName)
                        else viewModel.updateLocation(companyId, branchId, editTarget!!.id, newName)
                        showForm = false
                    } catch (e: Exception) { error = e.message }
                }
            },
            onCancel = { showForm = false })
    }
    pendingDelete?.let { l ->
        ConfirmDialog("Delete \"${l.name}\"?", "This action cannot be undone.", "Delete", onConfirm = {
            scope.launch { try { viewModel.deleteLocation(companyId, branchId, l.id) } catch (e: Exception) { error = e.message }; pendingDelete = null }
        }, onCancel = { pendingDelete = null })
    }
    error?.let { ErrorDialog(it) { error = null } }
}

// MARK: - Categories

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesManagementScreen(viewModel: AppViewModel, navController: NavController) {
    val companies by viewModel.companies.collectAsState()
    var selectedCompanyId by remember { mutableStateOf(companies.firstOrNull()?.id ?: "") }
    LaunchedEffect(companies) { if (selectedCompanyId.isEmpty()) selectedCompanyId = companies.firstOrNull()?.id ?: "" }
    val company = companies.firstOrNull { it.id == selectedCompanyId }
    val categories = company?.categories?.sortedBy { it.code } ?: emptyList()
    var showForm by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<Category?>(null) }
    var pendingDelete by remember { mutableStateOf<Category?>(null) }
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Category") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") } },
                actions = { IconButton(onClick = { editTarget = null; showForm = true }, enabled = company != null) { Icon(Icons.Default.Add, "Add") } }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // company selector
            var compExpanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = compExpanded, onExpandedChange = { compExpanded = it }, modifier = Modifier.padding(12.dp)) {
                OutlinedTextField(value = company?.name ?: "", onValueChange = {}, readOnly = true, label = { Text("Company") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(compExpanded) },
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth())
                ExposedDropdownMenu(expanded = compExpanded, onDismissRequest = { compExpanded = false }) {
                    companies.forEach { c -> DropdownMenuItem(text = { Text(c.name) }, onClick = { selectedCompanyId = c.id; compExpanded = false }) }
                }
            }
            if (categories.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No categories yet", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(categories, key = { it.id }) { cat ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(cat.code, style = MaterialTheme.typography.titleMedium)
                                val branchNames = company?.branches?.filter { cat.branchIds.contains(it.id) }?.joinToString(", ") { it.name } ?: ""
                                Text(if (cat.branchIds.isEmpty()) "All branches" else branchNames, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { editTarget = cat; showForm = true }) { Icon(Icons.Default.Edit, "Edit") }
                            IconButton(onClick = { pendingDelete = cat }) { Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
            }
        }
    }

    if (showForm && company != null) {
        CategoryFormDialog(company = company, existing = editTarget, onSave = { code, branchIds ->
            scope.launch {
                try {
                    if (editTarget == null) viewModel.createCategory(company.id, code, branchIds)
                    else viewModel.updateCategory(company.id, editTarget!!.id, code, branchIds)
                    showForm = false
                } catch (e: Exception) { error = e.message }
            }
        }, onCancel = { showForm = false })
    }
    pendingDelete?.let { cat ->
        ConfirmDialog("Delete \"${cat.code}\"?", "This action cannot be undone.", "Delete", onConfirm = {
            scope.launch { try { viewModel.deleteCategory(selectedCompanyId, cat.id) } catch (e: Exception) { error = e.message }; pendingDelete = null }
        }, onCancel = { pendingDelete = null })
    }
    error?.let { ErrorDialog(it) { error = null } }
}

@Composable
private fun CategoryFormDialog(company: Company, existing: Category?, onSave: (String, List<String>) -> Unit, onCancel: () -> Unit) {
    var code by remember { mutableStateOf(existing?.code ?: "") }
    val selected = remember { mutableStateListOf<String>().apply { existing?.branchIds?.let { addAll(it) } } }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(if (existing == null) "New Category" else "Edit Category") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = code, onValueChange = { code = it.uppercase() }, label = { Text("Code (e.g. CAM)") }, singleLine = true)
                Text("Branches (leave all off = all branches)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                company.branches.sortedBy { it.name }.forEach { b ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = selected.contains(b.id), onCheckedChange = { if (it) selected.add(b.id) else selected.remove(b.id) })
                        Text(b.name)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { if (code.isNotBlank()) onSave(code.trim(), selected.toList()) }, enabled = code.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
}

// MARK: - Shared helpers

@Composable
fun NameFormDialog(title: String, label: String, initial: String, onSave: (String) -> Unit, onCancel: () -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title) },
        text = { OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = { TextButton(onClick = { if (name.isNotBlank()) onSave(name.trim()) }, enabled = name.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
}

@Composable
fun ConfirmDialog(title: String, message: String, confirmLabel: String, onConfirm: () -> Unit, onCancel: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } }
    )
}

@Composable
fun ErrorDialog(message: String, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Error") }, text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } })
}

@Composable
private fun EmptyState(padding: PaddingValues, icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
    Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
