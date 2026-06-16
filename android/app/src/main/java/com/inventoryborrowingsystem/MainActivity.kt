package com.inventoryborrowingsystem

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.inventoryborrowingsystem.ui.components.GeoConsentGate
import com.inventoryborrowingsystem.ui.navigation.AppNavigation
import com.inventoryborrowingsystem.ui.theme.InventoryBorrowingSystemTheme
import com.inventoryborrowingsystem.viewmodel.AppViewModel

class MainActivity : ComponentActivity() {

    private lateinit var appViewModel: AppViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            appViewModel = viewModel()
            val theme by appViewModel.theme.collectAsState()

            // Observe lifecycle for app lock using DisposableEffect to prevent duplicate observers
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_STOP -> appViewModel.appDidBackground()
                        Lifecycle.Event.ON_START -> appViewModel.appDidForeground()
                        else -> {}
                    }
                }
                lifecycle.addObserver(observer)
                onDispose { lifecycle.removeObserver(observer) }
            }

            InventoryBorrowingSystemTheme(themeOption = theme) {
                AppNavigation(viewModel = appViewModel)
                GeoConsentGate(viewModel = appViewModel)
            }
        }
    }
}
