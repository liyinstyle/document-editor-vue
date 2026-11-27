<template>
  <div style="width:100%;height:100%">
    <!-- 事件统一走 config.events；加 onLoadComponentError 便于定位脚本/配置错误 -->
    <DocumentEditor
      :id="id"
      :document-server-url="serverUrl"
      :config="mergedConfig"
      :on-load-component-error="onLoadComponentError"
    />
  </div>
</template>

<script setup>
import { ref, computed, shallowRef, onUnmounted } from 'vue'
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
  lang: { type: String, default: 'zh-CN' },
  // 回调地址由父级/环境注入，禁止在组件里硬编码
  callbackUrl: { type: String, default: '' }
})

const emit = defineEmits(['ready', 'error', 'request-edit', 'request-close'])

// 是否有未保存的修改（由 onDocumentStateChange 维护）。实例用 shallowRef，避免被 Vue 深度代理
const isDirty = ref(false)
const editorInstance = shallowRef(null)

// 等待 forceSave 完成的 resolver + 兜底定时器
let pendingSaveResolve = null
let pendingSaveTimer = null

const clearPendingSave = (result) => {
  if (pendingSaveTimer) { clearTimeout(pendingSaveTimer); pendingSaveTimer = null }
  if (pendingSaveResolve) {
    const r = pendingSaveResolve
    pendingSaveResolve = null
    r(result)
  }
}

function onReady() {
  // onDocumentReady 触发时实例已注册到 window.DocEditor.instances
  editorInstance.value = window.DocEditor?.instances?.[props.id] || null
  isDirty.value = false
  console.log('[OnlyOffice] onDocumentReady, mode =', props.mode)
  emit('ready')
}

function onStateChange(e) {
  const changed = !!e?.data
  // 关键诊断：编辑文档时这里必须打印 data:true。若从不打印，说明没进编辑态或事件未送达
  console.log('[OnlyOffice] onDocumentStateChange =>', e)
  if (changed) {
    isDirty.value = true // 一旦改过就置脏
  } else if (pendingSaveResolve) {
    isDirty.value = false // 只有我们主动 forceSave 完成（data:false）才清脏
    clearPendingSave(true)
  }
  // 其它 data:false（协同/初始加载）一律不动脏标记
}

function onEditorError(err) {
  if (pendingSaveResolve) clearPendingSave(false)
  console.error('[OnlyOffice] onError', err)
  emit('error', err)
}

// view 模式下用户点击编辑器内“编辑文档”按钮时触发（不声明该事件，9.x 默认不显示编辑按钮）
function onRequestEditRights() {
  emit('request-edit')
}

// 调用实例 requestClose() 后，用户在原生弹窗里选择“关闭”时触发
function onRequestClose() {
  emit('request-close')
}

function onLoadComponentError(errorCode, errorDescription) {
  // -1 未知错误 / -2 api.js 加载失败 / -3 window.DocsAPI 未定义
  console.error('[OnlyOffice] load component error', errorCode, errorDescription)
  emit('error', { errorCode, errorDescription })
}

// 编辑器事件：放进 config.events 才会真正生效（官方文档：config.events 会覆盖所有 events_* 扁平属性）
const events = {
  onDocumentReady: onReady,
  onDocumentStateChange: onStateChange,
  onError: onEditorError,
  onRequestEditRights,
  onRequestClose
}

const mergedConfig = computed(() => ({
  ...props.config,
  editorConfig: {
    ...props.config.editorConfig, // 先保留后端返回的其它字段
    callbackUrl: props.callbackUrl || props.config.editorConfig?.callbackUrl,
    lang: props.lang,
    // 无论 edit/view 都显式给出 mode，避免后端残留 mode 或父级 mode 泄漏造成“看似可编辑实则 view”
    mode: props.mode,
    customization: {
      ...props.config.editorConfig?.customization,
      forcesave: true,  // 启用强制保存
      autosave: false   // 关闭自动保存
    },
    user: {
      ...props.config.editorConfig?.user,
      name: props.config.editorConfig?.user?.name || 'Anonymous'
    }
  },
  events // 放在 spread 之后，确保覆盖父组件/后端可能误传的 events
}))

// 返回 Promise：true=保存成功 / 无需保存；false=失败或无实例
function handleSave() {
  const inst = editorInstance.value
  if (!inst) return Promise.resolve(false)
  if (!isDirty.value) return Promise.resolve(true) // 没改过，直接算成功

  return new Promise((resolve) => {
    pendingSaveResolve = resolve
    pendingSaveTimer = setTimeout(() => clearPendingSave(false), 10000) // 兜底，防弹框卡死
    try {
      inst.forceSave()
    } catch (e) {
      console.error('[OnlyOffice] forceSave 失败', e)
      clearPendingSave(false)
    }
  })
}

// 官方原生关闭：由编辑器自己判断是否有未保存数据并弹原生确认框；
// 用户选“关闭”后会触发 onRequestClose（已在 events 中声明）
function requestClose() {
  const inst = editorInstance.value
  if (!inst) return
  if (typeof inst.requestClose === 'function') {
    inst.requestClose()
  } else {
    inst.destroyEditor()
  }
}

onUnmounted(() => {
  clearPendingSave(false)
  try { editorInstance.value?.destroyEditor() } catch (e) { /* 官方封装 beforeUnmount 已销毁一次，忽略重复调用 */ }
  if (window.DocEditor?.instances) window.DocEditor.instances[props.id] = undefined
  editorInstance.value = null
})

defineExpose({
  isDirty,                       // 父组件可直接当 boolean 读（Vue 会自动解包 ref）
  getIsDirty: () => isDirty.value,
  save: handleSave,
  requestClose                   // 可选：走 ONLYOFFICE 原生未保存确认
})
</script>
