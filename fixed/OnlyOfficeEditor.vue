<template>
  <div style="width:100%;height:100%">
    <!-- 事件统一走 config.events，@onlyoffice/document-editor-vue 会让 config.events 覆盖扁平 props -->
    <DocumentEditor
      :id="id"
      :document-server-url="serverUrl"
      :config="mergedConfig"
    />
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { DocumentEditor } from '@onlyoffice/document-editor-vue'

const props = defineProps({
  id: { type: String, default: () => `onlyoffice-editor-${Date.now()}` },
  serverUrl: { type: String, required: true },
  config: {
    type: Object,
    required: true,
    validator: (val) => !!(val.document?.url && val.document?.fileType && val.document?.key)
  },
  mode: { type: String, default: 'edit', validator: (v) => ['edit', 'view'].includes(v) },
  lang: { type: String, default: 'zh-CN' }
})

const emit = defineEmits(['ready', 'error', 'request-close'])

/* ------------------------------------------------------------------ *
 * 状态：isDirty 由 onDocumentStateChange 维护
 *  - data:true  → 有未保存改动，置脏
 *  - data:false → 仅当我们主动 forceSave 等待中才清脏；
 *                 初始加载 / 协同同步产生的 data:false 一律忽略，避免误清
 * ------------------------------------------------------------------ */
const isDirty = ref(false)
const editorInstance = ref(null)
const ready = ref(false)

// forceSave 等待句柄
let pendingSaveResolve = null
let pendingSaveTimer = null
// requestClose 等待句柄（官方关闭前检查）
let pendingCloseResolve = null

const clearPendingSave = (result) => {
  if (pendingSaveTimer) { clearTimeout(pendingSaveTimer); pendingSaveTimer = null }
  if (pendingSaveResolve) {
    const r = pendingSaveResolve
    pendingSaveResolve = null
    r(result)
  }
}

// 放进 config.events 才会真正生效（库的 onLoad 用 config.events 覆盖扁平 events_*）
const events = {
  onDocumentReady: onReady,
  onDocumentStateChange: onStateChange,
  onError: onEditorError,
  onRequestClose: onRequestClose
}

const mergedConfig = computed(() => ({
  ...props.config,
  editorConfig: {
    ...props.config.editorConfig,
    // 注意：callbackUrl 必须后端真实可达，否则 forceSave 不会落盘，data:false 也不会回推
    callbackUrl: props.config.editorConfig?.callbackUrl || 'https://nygl/onlyOffice/callback',
    lang: props.lang,
    ...(props.mode === 'view' ? { mode: props.mode } : {}),
    customization: {
      ...props.config.editorConfig?.customization,
      forcesave: true,   // 启用强制保存（forceSave 才会走 callback status=6）
      autosave: false    // 关闭自动保存，脏标记完全由我们控制
    },
    user: {
      ...props.config.editorConfig?.user,
      name: props.config.editorConfig?.user?.name || 'Anonymous'
    }
  },
  events // 放在 spread 之后，确保覆盖父组件/后端误传的 events
}))

function getInstance() {
  // 兜底：onDocumentReady 后实例已注册到 window.DocEditor.instances[id]
  return editorInstance.value || window.DocEditor?.instances?.[props.id] || null
}

function onReady() {
  editorInstance.value = getInstance()
  ready.value = true
  isDirty.value = false
  emit('ready')
}

function onStateChange(e) {
  const changed = !!e?.data
  if (changed) {
    isDirty.value = true
  } else if (pendingSaveResolve) {
    // 只有我们主动保存、服务端回推的 data:false 才清脏
    isDirty.value = false
    clearPendingSave(true)
  }
}

function onEditorError(err) {
  if (pendingSaveResolve) clearPendingSave(false)
  emit('error', err)
}

function onRequestClose() {
  // 官方：requestClose() 确认关闭后触发；或编辑器内置关闭按钮触发
  if (pendingCloseResolve) {
    const r = pendingCloseResolve
    pendingCloseResolve = null
    r(true)
  }
  emit('request-close')
}

defineExpose({
  isDirty, // 父组件可直接当 boolean 读（Vue 自动解包 ref）
  ready,
  getIsDirty: () => !!isDirty.value,
  getReady: () => ready.value,

  /**
   * 保存并等待落盘完成
   * @returns {Promise<boolean>} true=保存成功 / 无需保存；false=失败或超时
   */
  save() {
    const inst = getInstance()
    if (!inst) return Promise.resolve(false)
    if (!isDirty.value) return Promise.resolve(true) // 没改过，直接算成功

    return new Promise((resolve) => {
      pendingSaveResolve = resolve
      pendingSaveTimer = setTimeout(() => clearPendingSave(false), 10000) // 兜底，防卡死
      try {
        inst.forceSave()
      } catch (e) {
        console.error('保存失败', e)
        clearPendingSave(false)
      }
    })
  },

  /**
   * 官方关闭前检查：让 ONLYOFFICE 自己判断是否有未保存内容。
   * - 无未保存 → 立即触发 onRequestClose → resolve(true)
   * - 有未保存 → 弹 ONLYOFFICE 原生确认框（跟随 lang=zh-CN）：
   *     用户选「关闭」→ onRequestClose → resolve(true)
   *     用户选「继续编辑」→ 不触发，promise 保持 pending（父组件不会关闭，正确）
   * @returns {Promise<boolean>}
   */
  requestClose() {
    const inst = getInstance()
    if (!inst) return Promise.resolve(true)
    return new Promise((resolve) => {
      pendingCloseResolve = resolve
      try {
        inst.requestClose()
      } catch (e) {
        console.error('requestClose 失败', e)
        pendingCloseResolve = null
        resolve(true)
      }
    })
  }
})

onUnmounted(() => {
  clearPendingSave(false)
  pendingCloseResolve = null
  ready.value = false
  // 销毁交给 @onlyoffice/document-editor-vue 的 beforeUnmount：
  // 它会 destroyEditor() 并清掉 window.DocEditor.instances[id]。
  // 这里只清本地引用，避免重复 destroy 引发异常。
  editorInstance.value = null
})
</script>
