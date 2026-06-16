package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.compose.material.icons.filled.Check
import com.inventoryborrowingsystem.data.CountryCodes
import com.inventoryborrowingsystem.data.SKUStatus
import com.inventoryborrowingsystem.data.User
import com.inventoryborrowingsystem.data.UserRole
import com.inventoryborrowingsystem.ui.components.CountryCodePickerDialog
import com.inventoryborrowingsystem.ui.components.EmptyState
import com.inventoryborrowingsystem.viewmodel.AppViewModel
import kotlinx.coroutines.launch
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(viewModel: AppViewModel, navController: NavController) {
    val currentUser by viewModel.currentUser.collectAsState()
    val allUsers by viewModel.users.collectAsState()
    val skus by viewModel.skus.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var filterRole by remember { mutableStateOf<UserRole?>(null) }
    var filterCompanyId by remember { mutableStateOf<String?>(null) }
    val companies by viewModel.companies.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var showingAdd by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<User?>(null) }
    var pendingDisable by remember { mutableStateOf<User?>(null) }
    var pendingResume by remember { mutableStateOf<User?>(null) }
    var disableBlockedUser by remember { mutableStateOf<User?>(null) }
    var pendingResetPassword by remember { mutableStateOf<User?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var staffImportDiff by remember { mutableStateOf<com.inventoryborrowingsystem.data.StaffImportDiff?>(null) }
    val staffDirectory by viewModel.staffDirectory.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    val importLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) coroutineScope.launch {
            try { staffImportDiff = viewModel.diffStaffImport(viewModel.parseStaffEntries(context, uri)) }
            catch (e: Exception) { actionError = e.message }
        }
    }

    val visibleUsers = remember(allUsers, currentUser) {
        if (currentUser == null) emptyList()
        else allUsers.filter { user ->
            if (user.id == currentUser!!.id) false
            else when (currentUser!!.role) {
                UserRole.SUPERADMIN -> true
                UserRole.ADMIN -> user.role != UserRole.SUPERADMIN
                UserRole.WAREHOUSE_MANAGER -> user.role == UserRole.STAFF
                else -> false
            }
        }.sortedBy { it.name }
    }

    val displayedUsers = remember(visibleUsers, filterRole, filterCompanyId, searchQuery) {
        var result = if (filterRole == null) visibleUsers else visibleUsers.filter { it.role == filterRole }
        filterCompanyId?.let { cid -> result = result.filter { (it.warehouseIds ?: emptyList()).contains(cid) } }
        if (searchQuery.isNotBlank()) {
            val q = searchQuery.trim().lowercase()
            result = result.filter {
                it.name.lowercase().contains(q) || it.username.lowercase().contains(q) ||
                it.phone?.lowercase()?.contains(q) == true || it.email?.lowercase()?.contains(q) == true
            }
        }
        result
    }

    val availableFilterRoles = remember(visibleUsers) {
        val rolesInList = visibleUsers.map { it.role }.toSet()
        listOf(UserRole.STAFF, UserRole.WAREHOUSE_MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN).filter { it in rolesInList }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Users") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                actions = {
                    if (permissions?.canManageUsers == true) {
                        IconButton(onClick = { importLauncher.launch("*/*") }) {
                            Icon(Icons.Default.UploadFile, "Import staff directory")
                        }
                        IconButton(onClick = { showingAdd = true }) {
                            Icon(Icons.Default.Add, "Add user")
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
                    placeholder = { Text("Search by name or employee ID") },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = { if (searchQuery.isNotEmpty()) IconButton(onClick = { searchQuery = "" }) { Icon(Icons.Default.Clear, null) } },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 2.dp),
                    singleLine = true
                )
                if (availableFilterRoles.isNotEmpty()) {
                    LazyRow(
                        contentPadding = PaddingValues(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        item {
                            FilterChip(selected = filterRole == null, onClick = { filterRole = null }, label = { Text("All") })
                        }
                        items(availableFilterRoles) { role ->
                            FilterChip(
                                selected = filterRole == role,
                                onClick = { filterRole = role },
                                label = { Text(role.displayName) }
                            )
                        }
                    }
                }
                // Company filter — works alongside the role filter (both must match).
                if (companies.isNotEmpty()) {
                    LazyRow(
                        contentPadding = PaddingValues(start = 16.dp, top = 0.dp, end = 16.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        item {
                            FilterChip(selected = filterCompanyId == null, onClick = { filterCompanyId = null }, label = { Text("All companies") })
                        }
                        items(companies) { c ->
                            FilterChip(
                                selected = filterCompanyId == c.id,
                                onClick = { filterCompanyId = c.id },
                                label = { Text(c.name) }
                            )
                        }
                    }
                }

                if (displayedUsers.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState("No users", Icons.Default.Group)
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(start = 16.dp, top = 2.dp, end = 16.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(displayedUsers, key = { it.id }) { user ->
                            UserRow(
                                user = user,
                                skus = skus,
                                onEdit = { editTarget = user },
                                onDisable = { u ->
                                    if (skus.any { it.status == SKUStatus.BORROWED && it.borrowedByUserId == u.id }) {
                                        disableBlockedUser = u
                                    } else {
                                        pendingDisable = u
                                    }
                                },
                                onResume = { pendingResume = it },
                                onResetPassword = { pendingResetPassword = it }
                            )
                        }
                    }
                }
            }
        }
    }

    // Disable confirmation
    pendingDisable?.let { u ->
        AlertDialog(
            onDismissRequest = { pendingDisable = null },
            title = { Text("Disable \"${u.name}\"?") },
            text = { Text("The account will expire after 30 days of being disabled.") },
            confirmButton = {
                Button(
                    onClick = {
                        val target = u; pendingDisable = null
                        coroutineScope.launch {
                            try { viewModel.disableUser(target.id) } catch (e: Exception) { actionError = e.message }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("Disable") }
            },
            dismissButton = { TextButton(onClick = { pendingDisable = null }) { Text("Cancel") } }
        )
    }

    // Resume confirmation
    pendingResume?.let { u ->
        AlertDialog(
            onDismissRequest = { pendingResume = null },
            title = { Text("Resume \"${u.name}\"?") },
            text = { Text("This will reactivate the account.") },
            confirmButton = {
                Button(onClick = {
                    val target = u; pendingResume = null
                    coroutineScope.launch {
                        try { viewModel.resumeUser(target.id) } catch (e: Exception) { actionError = e.message }
                    }
                }) { Text("Resume") }
            },
            dismissButton = { TextButton(onClick = { pendingResume = null }) { Text("Cancel") } }
        )
    }

    // Reset password confirmation
    pendingResetPassword?.let { u ->
        AlertDialog(
            onDismissRequest = { pendingResetPassword = null },
            title = { Text("Reset Password for \"${u.name}\"?") },
            text = { Text("The user's password will be cleared and they will be required to set a new password on next login.") },
            confirmButton = {
                Button(
                    onClick = {
                        val target = u; pendingResetPassword = null
                        coroutineScope.launch {
                            try { viewModel.resetPasswordRequired(target.id) } catch (e: Exception) { actionError = e.message }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("Reset Password") }
            },
            dismissButton = { TextButton(onClick = { pendingResetPassword = null }) { Text("Cancel") } }
        )
    }

    // Disable blocked alert
    disableBlockedUser?.let { u ->
        AlertDialog(
            onDismissRequest = { disableBlockedUser = null },
            title = { Text("Cannot Disable \"${u.name}\"") },
            text = { Text("This user still has borrowed items. Ask them to return all items before disabling the account.") },
            confirmButton = { TextButton(onClick = { disableBlockedUser = null }) { Text("OK") } }
        )
    }

    // Action error
    actionError?.let { err ->
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } }
        )
    }

    // Add/Edit user sheet
    if (showingAdd) {
        UserFormSheetDialog(
            viewModel = viewModel,
            mode = UserFormMode.CREATE,
            onDismiss = { showingAdd = false }
        )
    }
    editTarget?.let { user ->
        UserFormSheetDialog(
            viewModel = viewModel,
            mode = UserFormMode.EDIT(user),
            onDismiss = { editTarget = null }
        )
    }
    staffImportDiff?.let { diff ->
        StaffImportReviewDialog(diff = diff, onConfirm = {
            viewModel.applyStaffDirectory(diff.all); staffImportDiff = null
        }, onDismiss = { staffImportDiff = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StaffImportReviewDialog(
    diff: com.inventoryborrowingsystem.data.StaffImportDiff,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Review Import", style = MaterialTheme.typography.titleLarge)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StaffStat("New", diff.added.size, Color(0xFF1B873F))
                StaffStat("Updated", diff.updated.size, Color(0xFFE08600))
                StaffStat("Unchanged", diff.unchanged.size, MaterialTheme.colorScheme.onSurfaceVariant)
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (diff.added.isNotEmpty()) {
                    item { Text("New people (${diff.added.size})", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(diff.added) { e ->
                        Column(Modifier.padding(vertical = 2.dp)) {
                            Text(e.name, fontWeight = FontWeight.SemiBold)
                            val sub = listOfNotNull(e.phone?.ifEmpty { null }, e.email?.ifEmpty { null }).joinToString(" · ")
                            if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (diff.updated.isNotEmpty()) {
                    item { Text("Updated info (${diff.updated.size})", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(diff.updated) { c ->
                        Column(Modifier.padding(vertical = 2.dp)) {
                            Text(c.new.name, fontWeight = FontWeight.SemiBold)
                            if ((c.old.phone ?: "") != (c.new.phone ?: ""))
                                Text("Phone: ${c.old.phone ?: "—"} → ${c.new.phone ?: "—"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if ((c.old.email ?: "") != (c.new.email ?: ""))
                                Text("Email: ${c.old.email ?: "—"} → ${c.new.email ?: "—"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (diff.added.isEmpty() && diff.updated.isEmpty()) {
                    item { Text("No new people or changes — the directory is already up to date.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(onClick = onConfirm) { Text("Update") }
            }
        }
    }
}

@Composable
private fun RowScope.StaffStat(label: String, n: Int, color: Color) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UserRow(
    user: User,
    skus: List<com.inventoryborrowingsystem.data.SKUItem>,
    onEdit: (User) -> Unit,
    onDisable: (User) -> Unit,
    onResume: (User) -> Unit,
    onResetPassword: (User) -> Unit
) {
    val disabled = user.isDisabled == true
    val expired = isUserExpired(user)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    user.name,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
                )
                RoleBadge(user.role)
                if (expired) StatusTag("Expired", MaterialTheme.colorScheme.error)
                else if (disabled) StatusTag("Disabled", MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(user.username, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            user.phone?.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
            }

            // Action buttons row
            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (!disabled) {
                    OutlinedButton(
                        onClick = { onEdit(user) },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                    ) { Text("Edit", style = MaterialTheme.typography.labelMedium) }
                    OutlinedButton(
                        onClick = { onResetPassword(user) },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFF9500)),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFF9500))
                    ) { Text("Reset PW", style = MaterialTheme.typography.labelMedium) }
                    OutlinedButton(
                        onClick = { onDisable(user) },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)
                    ) { Text("Disable", style = MaterialTheme.typography.labelMedium) }
                } else {
                    Button(onClick = { onResume(user) }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
                        Text("Resume", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun RoleBadge(role: UserRole) {
    val color = roleColor(role)
    Surface(shape = MaterialTheme.shapes.small, color = color.copy(alpha = 0.15f)) {
        Text(
            role.displayName,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = color
        )
    }
}

@Composable
private fun StatusTag(label: String, color: Color) {
    Surface(shape = MaterialTheme.shapes.small, color = color.copy(alpha = 0.12f)) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = color
        )
    }
}

private fun roleColor(role: UserRole): Color = when (role) {
    UserRole.STAFF -> Color(0xFF34C759)
    UserRole.WAREHOUSE_MANAGER -> Color(0xFF007AFF)
    UserRole.ADMIN -> Color(0xFFFF9500)
    UserRole.SUPERADMIN -> Color(0xFFFF3B30)
}

private fun isUserExpired(user: User): Boolean {
    if (user.isDisabled != true) return false
    val dateStr = user.disabledAt ?: user.updatedAt ?: return false
    val date = parseIso8601(dateStr) ?: return false
    val cal = Calendar.getInstance()
    cal.time = date
    val then = cal
    val now = Calendar.getInstance()
    val days = ((now.timeInMillis - then.timeInMillis) / 86400000L).toInt()
    return days >= 30
}

private fun parseIso8601(dateStr: String): Date? {
    val formats = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")
    for (fmt in formats) {
        try {
            val sdf = java.text.SimpleDateFormat(fmt, Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            return sdf.parse(dateStr)
        } catch (_: Exception) {}
    }
    return null
}

sealed class UserFormMode {
    object CREATE : UserFormMode()
    data class EDIT(val user: User) : UserFormMode()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserFormSheetDialog(
    viewModel: AppViewModel,
    mode: UserFormMode,
    onDismiss: () -> Unit
) {
    val currentUser by viewModel.currentUser.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    val isEditing = mode is UserFormMode.EDIT
    val editUser = (mode as? UserFormMode.EDIT)?.user

    val staffDirectory by viewModel.staffDirectory.collectAsState()
    var username by remember { mutableStateOf(editUser?.username ?: "") }
    var name by remember { mutableStateOf(editUser?.name ?: "") }
    var selectedRole by remember { mutableStateOf(editUser?.role ?: UserRole.STAFF) }
    var phoneCountryCode by remember { mutableStateOf(editUser?.phoneCountryCode ?: "+86") }
    var phone by remember { mutableStateOf(editUser?.phone ?: "") }
    var email by remember { mutableStateOf(editUser?.email ?: "") }
    var directoryMatched by remember { mutableStateOf(isEditing) }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showCountryPicker by remember { mutableStateOf(false) }
    val companies by viewModel.companies.collectAsState()
    val companyIds = remember { mutableStateListOf<String>().apply { editUser?.warehouseIds?.let { addAll(it) } } }
    val branchIds = remember { mutableStateListOf<String>().apply { editUser?.branchIds?.let { addAll(it) } } }

    // When the typed name exactly matches a directory entry, auto-fill contact + mark matched.
    LaunchedEffect(name) {
        if (isEditing) return@LaunchedEffect
        val entry = viewModel.lookupStaffEntry(name)
        if (entry != null) {
            val p = entry.phone
            if (!p.isNullOrEmpty()) {
                if (p.startsWith("+")) {
                    val code = CountryCodes.all.map { it.code }.sortedByDescending { it.length }.firstOrNull { p.startsWith(it) }
                    if (code != null) { phoneCountryCode = code; phone = p.drop(code.length).filter { it.isDigit() } }
                    else { phoneCountryCode = "+86"; phone = p.filter { it.isDigit() } }
                } else { phoneCountryCode = "+86"; phone = p.filter { it.isDigit() } }
            } else { phoneCountryCode = "+86"; phone = "" }
            email = entry.email ?: ""
            directoryMatched = true
        } else directoryMatched = false
    }

    val availableRoles = when (currentUser?.role) {
        UserRole.SUPERADMIN -> listOf(UserRole.STAFF, UserRole.WAREHOUSE_MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN)
        UserRole.ADMIN -> listOf(UserRole.STAFF, UserRole.WAREHOUSE_MANAGER)
        else -> listOf(UserRole.STAFF)
    }

    fun validate(): String? {
        if (name.trim().isEmpty()) return "Display name is required."
        val ph = phone.trim()
        if (ph.isNotEmpty()) {
            if (phoneCountryCode == "+86" && ph.length != 11) return "China (+86) phone must be exactly 11 digits."
        }
        val em = email.trim()
        if (em.isNotEmpty()) {
            val atIdx = em.indexOf('@')
            if (atIdx < 1 || !em.substring(atIdx + 1).contains('.')) return "Email must include a domain (e.g. user@example.com)."
        }
        return null
    }

    val canSubmit = if (isEditing) name.trim().isNotEmpty()
    else name.trim().isNotEmpty() && username.trim().isNotEmpty() && directoryMatched

    ModalBottomSheet(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(if (isEditing) "Edit User" else "New User", style = MaterialTheme.typography.titleLarge)
                Row {
                    TextButton(onClick = { if (!isSubmitting) onDismiss() }) { Text("Cancel") }
                    Button(
                        onClick = {
                            val err = validate()
                            if (err != null) { errorMessage = err; return@Button }
                            if (!canSubmit) return@Button
                            isSubmitting = true
                            coroutineScope.launch {
                                try {
                                    val ph = phone.trim().ifEmpty { null }
                                    val cc = if (ph != null) phoneCountryCode else null
                                    val em = email.trim().ifEmpty { null }
                                    val isAll = selectedRole == UserRole.SUPERADMIN
                                    val whIds = if (isAll) emptyList() else companyIds.toList()
                                    // Keep only branches under a selected company.
                                    val brIds = if (isAll) emptyList() else companies.filter { companyIds.contains(it.id) }.flatMap { it.branches }.map { it.id }.filter { branchIds.contains(it) }
                                    if (isEditing && editUser != null) {
                                        viewModel.updateUser(editUser.id, name.trim(), selectedRole.value, ph, cc, em, editUser.isDisabled ?: false, whIds, brIds)
                                    } else {
                                        viewModel.createUser(username = username.trim(), name = name.trim(), role = selectedRole.value, phone = ph, phoneCountryCode = cc, email = em, warehouseIds = whIds, branchIds = brIds)
                                    }
                                    onDismiss()
                                } catch (e: Exception) {
                                    errorMessage = e.message
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = !isSubmitting && canSubmit
                    ) { Text(if (isSubmitting) "…" else if (isEditing) "Save" else "Add") }
                }
            }

            if (!isEditing) {
                OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Employee ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None, autoCorrect = false))
            }
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Display name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (!isEditing) {
                if (!directoryMatched && name.trim().isNotEmpty()) {
                    viewModel.staffSuggestions(name).forEach { entry ->
                        Surface(onClick = { name = entry.name }, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.PersonSearch, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(8.dp))
                                Text(entry.name, Modifier.weight(1f))
                                entry.phone?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
                when {
                    directoryMatched -> Text("✓ Matched from staff directory", style = MaterialTheme.typography.labelSmall, color = Color(0xFF1B873F))
                    staffDirectory == null -> Text("Import a staff directory (xlsx/CSV) first — users must match a directory entry.", style = MaterialTheme.typography.labelSmall, color = Color(0xFFE08600))
                    name.trim().isNotEmpty() -> Text("This name is not in the staff directory. Pick a suggestion to continue.", style = MaterialTheme.typography.labelSmall, color = Color(0xFFE08600))
                }
                Text("No password needed — the user sets their own on first login after verifying their name and phone.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Phone with country code
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val selectedEntry = CountryCodes.all.firstOrNull { it.code == phoneCountryCode } ?: CountryCodes.recommended[0]
                OutlinedButton(onClick = { showCountryPicker = true }, modifier = Modifier.wrapContentWidth()) {
                    Text("${selectedEntry.flag} ${selectedEntry.code}")
                }
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it.filter { c -> c.isDigit() } },
                    label = { Text("Phone") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                )
            }

            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Email,
                    capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None, autoCorrect = false))

            Text("Role", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                availableRoles.forEachIndexed { idx, role ->
                    SegmentedButton(
                        selected = selectedRole == role,
                        onClick = { selectedRole = role },
                        shape = SegmentedButtonDefaults.itemShape(index = idx, count = availableRoles.size)
                    ) { Text(role.displayName, style = MaterialTheme.typography.labelSmall) }
                }
            }

            // Company scope (warehouseIds). Hidden for superadmin/admin (they see all).
            // When a company is checked, optionally narrow to specific branches —
            // no branch checked = whole company.
            if (selectedRole != UserRole.SUPERADMIN && companies.isNotEmpty()) {
                Text("Companies (access scope)", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                companies.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            if (companyIds.contains(c.id)) { companyIds.remove(c.id); c.branches.forEach { branchIds.remove(it.id) } }
                            else companyIds.add(c.id)
                        }.padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(checked = companyIds.contains(c.id), onCheckedChange = {
                            if (it) { if (!companyIds.contains(c.id)) companyIds.add(c.id) } else { companyIds.remove(c.id); c.branches.forEach { b -> branchIds.remove(b.id) } }
                        })
                        Text(c.name)
                    }
                    if (companyIds.contains(c.id)) {
                        c.branches.forEach { b ->
                            Row(
                                Modifier.fillMaxWidth().padding(start = 24.dp).clickable {
                                    if (branchIds.contains(b.id)) branchIds.remove(b.id) else branchIds.add(b.id)
                                },
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(checked = branchIds.contains(b.id), onCheckedChange = {
                                    if (it) { if (!branchIds.contains(b.id)) branchIds.add(b.id) } else branchIds.remove(b.id)
                                })
                                Text(b.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }

    if (showCountryPicker) {
        CountryCodePickerDialog(
            selected = phoneCountryCode,
            onSelect = { phoneCountryCode = it },
            onDismiss = { showCountryPicker = false }
        )
    }
}
