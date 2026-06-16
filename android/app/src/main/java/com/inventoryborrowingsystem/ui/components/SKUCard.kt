package com.inventoryborrowingsystem.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inventoryborrowingsystem.data.SKUItem
import com.inventoryborrowingsystem.data.SKUStatus
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun SKUCard(item: SKUItem, modifier: Modifier = Modifier) {
    val codeColor = skuCodeColor(item)

    Column(modifier = modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = item.displayCode,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = codeColor,
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.width(12.dp))
            StatusPill(status = item.status)
        }
        if (!item.serialNumber.isNullOrEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    text = item.serialNumber!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        if (!item.descriptionText.isNullOrEmpty()) {
            Text(
                text = item.descriptionText!!,
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!item.parkName.isNullOrEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Default.LocationOn, contentDescription = null,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = item.parkName!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (item.status == SKUStatus.REPAIRING && !item.repairRequestedByName.isNullOrEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Default.Person, contentDescription = null,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = item.repairRequestedByName!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
fun StatusPill(status: SKUStatus, modifier: Modifier = Modifier) {
    val color = statusColor(status)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.16f)
    ) {
        Text(
            text = status.displayName,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = color
        )
    }
}

@Composable
fun statusColor(status: SKUStatus): Color = when (status) {
    SKUStatus.AVAILABLE -> Color(0xFF34C759)
    SKUStatus.BORROWED -> Color(0xFF007AFF)
    SKUStatus.REPAIRING -> Color(0xFFFF9500)
    SKUStatus.DISPOSED, SKUStatus.SOLD -> Color(0xFFFF3B30)
}

@Composable
fun skuCodeColor(item: SKUItem): Color {
    val rawString = item.lastScannedAt ?: item.createdAt ?: return MaterialTheme.colorScheme.onSurface
    val date = parseIso8601(rawString) ?: return MaterialTheme.colorScheme.onSurface
    val cal = Calendar.getInstance()
    val now = Date()
    cal.time = now
    cal.add(Calendar.MONTH, -2)
    val twoMonthsAgo = cal.time
    cal.time = now
    cal.add(Calendar.MONTH, -1)
    val oneMonthAgo = cal.time
    return when {
        date.before(twoMonthsAgo) -> Color(0xFFFF3B30)
        date.before(oneMonthAgo) -> Color(0xFFFF9500)
        else -> Color.Unspecified
    }
}

fun parseIso8601(dateStr: String): Date? {
    val formats = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
    )
    for (fmt in formats) {
        try {
            val sdf = SimpleDateFormat(fmt, Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            return sdf.parse(dateStr)
        } catch (_: Exception) {}
    }
    return null
}

@Composable
fun EmptyState(title: String, iconVector: androidx.compose.ui.graphics.vector.ImageVector = Icons.Default.Inbox) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = iconVector,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

fun formatShortDate(value: String): String {
    val date = parseIso8601(value) ?: return value
    val cal = Calendar.getInstance()
    val today = Calendar.getInstance()
    cal.time = date
    return if (cal.get(Calendar.YEAR) == today.get(Calendar.YEAR) &&
               cal.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)) {
        SimpleDateFormat("HH:mm", Locale.US).format(date)
    } else {
        SimpleDateFormat("MMM d", Locale.US).format(date)
    }
}

fun formatTimestamp(value: String): String {
    val date = parseIso8601(value) ?: return value
    return SimpleDateFormat("d MMM yyyy HH:mm", Locale.US).format(date)
}

fun elapsedTime(value: String): String {
    val date = parseIso8601(value) ?: return ""
    val total = ((System.currentTimeMillis() - date.time) / 1000L).toInt()
    val seconds = total % 60
    val minutes = (total / 60) % 60
    val hours = (total / 3600) % 24
    val days = total / 86400
    return when {
        days > 0 -> "${days}d ${hours}h"
        hours > 0 -> "${hours}h ${minutes}m"
        minutes > 0 -> "${minutes}m ${seconds}s"
        else -> "${maxOf(0, seconds)}s"
    }
}

fun recordLabel(type: String): String = when (type) {
    "borrow" -> "Borrowed"
    "return" -> "Returned"
    "repair" -> "Sent for Repair"
    "repaired", "return_after_repair" -> "Returned from Repair"
    "transfer" -> "Transferred"
    "sold" -> "Sold"
    "disposal" -> "Disposed"
    else -> type.replaceFirstChar { it.uppercase() }
}

fun recordColor(type: String): Color = when (type) {
    "borrow" -> Color(0xFFFF9500)
    "return" -> Color(0xFF34C759)
    "repair" -> Color(0xFFFF3B30)
    "repaired", "return_after_repair" -> Color(0xFF007AFF)
    "transfer" -> Color(0xFFAF52DE)
    else -> Color.Gray
}
