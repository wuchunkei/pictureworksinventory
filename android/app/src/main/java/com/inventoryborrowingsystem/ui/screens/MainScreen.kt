package com.inventoryborrowingsystem.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.inventoryborrowingsystem.viewmodel.AppViewModel

sealed class BottomNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector
) {
    object Home : BottomNavItem("home", "Home", Icons.Outlined.Home, Icons.Filled.Home)
    object Search : BottomNavItem("search", "Search", Icons.Outlined.Search, Icons.Filled.Search)
    object Notifications : BottomNavItem("notifications", "Notify", Icons.Outlined.Notifications, Icons.Filled.Notifications)
    object Status : BottomNavItem("status", "Status", Icons.Outlined.Inventory2, Icons.Filled.Inventory2)
    object Me : BottomNavItem("me", "Me", Icons.Outlined.Person, Icons.Filled.Person)
}

@Composable
fun MainScreen(appViewModel: AppViewModel) {
    val mainNavController = rememberNavController()
    val notificationBadgeCount by appViewModel.notificationBadgeCount.collectAsState()
    val borrowedItems by appViewModel.borrowedItems.collectAsState()

    val bottomNavItems = listOf(
        BottomNavItem.Home,
        BottomNavItem.Search,
        BottomNavItem.Notifications,
        BottomNavItem.Status,
        BottomNavItem.Me
    )

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by mainNavController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination
                bottomNavItems.forEach { item ->
                    val selected = currentDestination?.hierarchy?.any { it.route == item.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            mainNavController.navigate(item.route) {
                                popUpTo(mainNavController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            val badgeCount = when (item) {
                                BottomNavItem.Notifications -> notificationBadgeCount
                                BottomNavItem.Status -> borrowedItems.size
                                else -> 0
                            }
                            if (badgeCount > 0) {
                                BadgedBox(badge = { Badge { Text("$badgeCount") } }) {
                                    Icon(if (selected) item.selectedIcon else item.icon, contentDescription = item.label)
                                }
                            } else {
                                Icon(if (selected) item.selectedIcon else item.icon, contentDescription = item.label)
                            }
                        },
                        label = { Text(item.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = mainNavController,
            startDestination = BottomNavItem.Home.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(BottomNavItem.Home.route) {
                val nestedNavController = rememberNavController()
                NavHost(navController = nestedNavController, startDestination = "home_root") {
                    composable("home_root") { HomeScreen(appViewModel, nestedNavController) }
                    composable("recent_activity") { RecentActivityScreen(appViewModel, nestedNavController) }
                    composable("inventory") { InventoryScreen(appViewModel, nestedNavController) }
                    composable("sku_detail/{skuId}") { backStackEntry ->
                        SKUDetailScreen(appViewModel, backStackEntry.arguments?.getString("skuId") ?: "", nestedNavController)
                    }
                    composable("companies") { CompaniesScreen(appViewModel, nestedNavController) }
                    composable("branches/{companyId}") { backStackEntry ->
                        BranchListScreen(appViewModel, nestedNavController, backStackEntry.arguments?.getString("companyId") ?: "")
                    }
                    composable("locations/{companyId}/{branchId}") { backStackEntry ->
                        LocationListScreen(appViewModel, nestedNavController,
                            backStackEntry.arguments?.getString("companyId") ?: "",
                            backStackEntry.arguments?.getString("branchId") ?: "")
                    }
                    composable("categories") { CategoriesManagementScreen(appViewModel, nestedNavController) }
                    composable("records") { RecordsScreen(appViewModel, nestedNavController) }
                    composable("users") { UsersScreen(appViewModel, nestedNavController) }
                    composable("user_logs") { UserLogsScreen(appViewModel, nestedNavController) }
                }
            }
            composable(BottomNavItem.Search.route) {
                SearchScreen(appViewModel)
            }
            composable(BottomNavItem.Notifications.route) {
                val nestedNavController = rememberNavController()
                NavHost(navController = nestedNavController, startDestination = "notifications_root") {
                    composable("notifications_root") { NotificationsScreen(appViewModel, nestedNavController) }
                    composable("acf_resubmit/{formId}") { backStackEntry ->
                        ACFResubmitScreen(appViewModel, backStackEntry.arguments?.getString("formId") ?: "", nestedNavController)
                    }
                    composable("notification_detail/{notificationId}") { backStackEntry ->
                        NotificationDetailScreen(appViewModel, backStackEntry.arguments?.getString("notificationId") ?: "", nestedNavController)
                    }
                }
            }
            composable(BottomNavItem.Status.route) {
                val nestedNavController = rememberNavController()
                NavHost(navController = nestedNavController, startDestination = "status_root") {
                    composable("status_root") { StatusScreen(appViewModel, nestedNavController) }
                    composable("status_detail/{skuId}") { backStackEntry ->
                        StatusDetailScreen(appViewModel, backStackEntry.arguments?.getString("skuId") ?: "", nestedNavController)
                    }
                }
            }
            composable(BottomNavItem.Me.route) {
                val nestedNavController = rememberNavController()
                NavHost(navController = nestedNavController, startDestination = "me_root") {
                    composable("me_root") { MeScreen(appViewModel, nestedNavController) }
                    composable("profile") { ProfileScreen(appViewModel, nestedNavController) }
                    composable("settings") { SettingsScreen(appViewModel, nestedNavController) }
                    composable("email_alerts") { SMTPSettingsScreen(appViewModel, nestedNavController) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CompaniesPlaceholderScreen(navController: NavController) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Company") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Column(
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(Icons.Default.Business, contentDescription = null, modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Company Management", style = MaterialTheme.typography.titleMedium)
                Text("Coming in next version", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategoriesPlaceholderScreen(navController: NavController) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Category") },
                navigationIcon = { IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.Default.ArrowBack, "Back")
                }}
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Column(
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(Icons.Default.Label, contentDescription = null, modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Category Management", style = MaterialTheme.typography.titleMedium)
                Text("Coming in next version", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
