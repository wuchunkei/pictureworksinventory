package com.inventoryborrowingsystem.data

/**
 * Bundled list of backend routes (client configuration, not server state).
 * The login screen can pick a node before any network call. Edit when routes change.
 * Android ships the production node set.
 */
object ServerNodeCatalog {
    val nodes: List<ServerNodeInfo> = listOf(
        ServerNodeInfo("Cloudflare(HKG)", "https://inventory-cloudflare.wuchunkei.com/api"),
        ServerNodeInfo("Tailscale(HKG)", "https://hkx86-production.longhair-mizar.ts.net/api"),
        ServerNodeInfo("Ngrok(HKG)", "https://arguable-olive-anew.ngrok-free.dev/api"),
        ServerNodeInfo("Cloudflare(SJC)", "https://sanjose.wuchunkei.com/api"),
        ServerNodeInfo("Oracle(SJC)", "https://sjc.wuchunkei.com:5173/api"),
        ServerNodeInfo("CTExcel", "https://inventory-ctexcel.wuchunkei.com:55173/api"),
        ServerNodeInfo("CMLink", "https://inventory-cmlink.wuchunkei.com:55173/api")
    )

    val defaultUrl: String get() = nodes.firstOrNull()?.url ?: "https://inventory-cloudflare.wuchunkei.com/api"

    fun contains(url: String): Boolean = nodes.any { it.url == url }
}
