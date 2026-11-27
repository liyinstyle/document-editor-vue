<!--
  父组件 Suggestion（在线编辑弹窗）修改清单
  说明：本文件不是可直接运行的页面，而是把需要改动的【模板片段】和【脚本函数】按“替换后”给出，
  对照你的原文件逐段替换即可。核心修复点：
  1) 每次打开弹窗都按当前行 status 显式决定 mode，杜绝 mode='view' 残留（这是二次确认不弹的首要原因）
  2) X / ESC / 底部“关闭”按钮 统一走同一个脏检查拦截函数
  3) 接收子组件 request-edit（view 转编辑）与 request-close（原生确认后关闭）
  4) callbackUrl 改为从环境/配置注入，不再写死
-->

<!-- ============ ① 模板：文档编辑弹窗（替换原 el-dialog 这一段） ============ -->
<el-dialog
  v-model="dialogVisible"
  title="文档在线编辑"
  width="95%"
  top="5vh"
  append-to-body
  :close-on-click-modal="false"
  destroy-on-close
  :before-close="handleBeforeClose"
>
  <div style="width:100%;height:750px">
    <OnlyOfficeEditor
      ref="editorRef"
      :server-url="onlyOfficeServer"
      :config="editorConfig"
      :mode="mode"
      :callback-url="onlyOfficeCallback"
      @ready="onEditorReady"
      @error="onEditorError"
      @request-edit="handleRequestEdit"
      @request-close="doClose"
    />
  </div>

  <template #footer>
    <el-button @click="handleClose" :disabled="isSaving">关闭</el-button>
  </template>
</el-dialog>

<script setup name="Suggestion" lang="ts">
// ============ ② 脚本：新增/修改的变量与函数（对照替换） ============

// 回调地址：放到环境变量里（.env 的 VITE_ONLYOFFICE_CALLBACK），不要硬编码
const onlyOfficeCallback = import.meta.env.VITE_ONLYOFFICE_CALLBACK || ''

// 原有：const mode = ref('edit')  保留即可

/**
 * 打开预览/编辑：每次都【显式】重置 mode，修掉 view 残留
 * 原代码只在 status===1 时把 mode 设为 view，却没有在其它分支复位，
 * 且 X 关闭路径也不复位，导致看过一次“查看”后，后面所有文档都以 view 打开，
 * view 只读 -> onDocumentStateChange 永远不会回 data:true -> isDirty 恒为 false -> 不弹二次确认
 */
const handlePreview = async (row?: SuggestionVO) => {
  const atts = await listAttachments(row?.id, hrefType.value) || []

  // 关键：按当前行显式决定模式，而不是只改一个方向
  mode.value = row.status === 1 ? 'view' : 'edit'

  if (row.status === 0 || row.status === 2) {
    row.status = 0
  }
  await updateSuggestion(row)
  await getList()

  await openEditDialog(atts.rows[0].id)
}

/** view 模式下用户点编辑器内“编辑文档”按钮：切到 edit，封装层会自动以新 config 重建编辑器 */
const handleRequestEdit = () => {
  mode.value = 'edit'
}

/** 真正关闭弹窗的唯一出口：复位可见性与模式 */
const doClose = () => {
  dialogVisible.value = false
  mode.value = 'edit' // 关闭后统一复位，双保险
}

/**
 * 统一的“能否关闭”判断：返回 true 才允许关闭
 * 保留你原来的三态交互：保存并关闭 / 不保存 / 取消(留在当前页)
 */
const confirmClose = async () => {
  const editor = editorRef.value
  // 没有未保存内容 -> 直接关
  if (!editor || !editor.getIsDirty()) return true

  try {
    await ElMessageBox.confirm(
      '文档有未保存的更改，是否保存后再关闭？',
      '提示',
      {
        confirmButtonText: '保存并关闭',
        cancelButtonText: '不保存',
        distinguishCancelAndClose: true, // 区分“不保存”按钮与右上角 X/ESC
        type: 'warning'
      }
    )
    // “保存并关闭”：等 forceSave 真正完成再关（destroy-on-close 会销毁编辑器）
    isSaving.value = true
    const ok = await editor.save()
    isSaving.value = false
    if (!ok) {
      ElMessage.error('保存失败，请检查回调服务后重试')
      return false
    }
    return true
  } catch (action) {
    // 'cancel' = 点了“不保存” -> 允许关闭；'close' = 点了 X/ESC -> 留在当前页
    return action === 'cancel'
  }
}

/** 点弹框 X / 按 ESC 触发（close-on-click-modal 已关，遮罩不触发） */
const handleBeforeClose = (done: () => void) => {
  if (isSaving.value) {
    ElMessage.warning('正在保存，请不要关闭')
    return
  }
  confirmClose().then((canClose) => {
    if (canClose) {
      done()
      mode.value = 'edit' // done 之后复位模式
    }
  })
}

/** 底部“关闭”按钮：与 X 走同一套脏检查 */
const handleClose = async () => {
  if (isSaving.value) {
    ElMessage.warning('正在保存，请不要关闭')
    return
  }
  const canClose = await confirmClose()
  if (canClose) doClose()
}

// ============ ③ 可选：保存按钮改为正确 await（原 handleSave 没等 Promise） ============
const handleSave = async () => {
  if (isSaving.value) return
  isSaving.value = true
  try {
    const ok = await editorRef.value.save()
    ok ? ElMessage.success('保存成功') : ElMessage.error('保存失败，请检查回调服务')
  } finally {
    isSaving.value = false
  }
}

// 原有 onEditorReady / onEditorError 保持不变
</script>
