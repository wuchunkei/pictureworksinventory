package com.inventoryborrowingsystem.ui.components

import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import java.io.ByteArrayOutputStream

/** Holds the drawn strokes and can rasterize them to a transparent PNG (base64). */
class SignatureState {
    val strokes = mutableStateListOf<MutableList<Offset>>()
    var canvasWidth = 0
    var canvasHeight = 0
    val isEmpty: Boolean get() = strokes.all { it.size < 2 }

    fun clear() { strokes.clear() }

    /** Transparent PNG of the signature, base64-encoded, or null if empty. */
    fun toBase64Png(strokeColor: Int = android.graphics.Color.BLACK): String? {
        if (isEmpty || canvasWidth <= 0 || canvasHeight <= 0) return null
        val bmp = Bitmap.createBitmap(canvasWidth, canvasHeight, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bmp)
        val paint = android.graphics.Paint().apply {
            color = strokeColor
            strokeWidth = 6f
            style = android.graphics.Paint.Style.STROKE
            strokeCap = android.graphics.Paint.Cap.ROUND
            strokeJoin = android.graphics.Paint.Join.ROUND
            isAntiAlias = true
        }
        for (stroke in strokes) {
            if (stroke.size < 2) continue
            val path = android.graphics.Path()
            path.moveTo(stroke[0].x, stroke[0].y)
            for (i in 1 until stroke.size) path.lineTo(stroke[i].x, stroke[i].y)
            c.drawPath(path, paint)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}

@Composable
fun rememberSignatureState(): SignatureState = remember { SignatureState() }

/** A finger-drawable signature pad. Records strokes into [state]. */
@Composable
fun SignaturePad(state: SignatureState, modifier: Modifier = Modifier, onChange: () -> Unit = {}) {
    var current by remember { mutableStateOf<MutableList<Offset>?>(null) }
    Canvas(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { offset ->
                        val s = mutableListOf(offset)
                        current = s
                        state.strokes.add(s)
                    },
                    onDrag = { change, _ ->
                        current?.add(change.position)
                        // trigger recomposition by touching the list
                        state.strokes[state.strokes.lastIndex] = current!!
                        onChange()
                    },
                    onDragEnd = { current = null; onChange() }
                )
            }
    ) {
        state.canvasWidth = size.width.toInt()
        state.canvasHeight = size.height.toInt()
        for (stroke in state.strokes) {
            for (i in 1 until stroke.size) {
                drawLine(
                    color = Color.Black,
                    start = stroke[i - 1],
                    end = stroke[i],
                    strokeWidth = 6f,
                    cap = StrokeCap.Round
                )
            }
        }
    }
}
