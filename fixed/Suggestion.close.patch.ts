/* =====================================================================
 * 父组件（Suggestion.vue）关闭链路修正片段
 * 仅替换下方列出的函数 / 模板块即可，其余保持不变。
 * 配套子组件：OnlyOfficeEditor.vue（已修正版）
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 1) 模板：给编辑器加 @request-close（官方 requestClose 确认后的回调，可选兜底）
 *    <OnlyOfficeEditor
 *      ref="editorRef"
 *      :server-url="onlyOfficeServer"
 *      :config="editorConfig"
 *      :mode="mode"
 *      @ready="onEditorReady"
 *      @error="onEditorError"
 *      @request-close="onEditorRequestClose"   ← 新增
 *    />
 * ------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
 * 2) handlePreview：修复 mode 残留 —— 打开可编辑文档时必须显式复位为 edit
 *    原代码只在 status===1 时设 view，从不复位 edit；
 *    若上次打开过 view 文档，之后的编辑文档会一直以 view 打开 → 无法编辑 → 不脏 → 不弹确认。
 * ------------------------------------------------------------------- */
const handlePreview = async (row?: SuggestionVO) => {
  const atts = await listAttachments(row?.id, hrefType.value) || []

  // 先按状态确定模式（关键：可编辑时显式置 edit，避免 view 残留）
  mode.value = row?.status === 1 ? 'view' : 'edit'

  if (row.status === 0 || row.status === 2) {
    row.status = 0
  }
  await updateSuggestion(row)
  await getList()

  await openEditDialog(atts.rows[0].id) // 文档在线编辑
}

/* ---------------------------------------------------------------------
 * 3) openEditDialog：打开前再次兜底复位模式
 * ------------------------------------------------------------------- */
const openEditDialog = async (profileId: number | string) => {
  if (profileId === '' || typeof profileId === undefined) {
    ElMessage.error('文档加载出错！')
    return
  }
  // 兜底复位：防止任何路径下 mode 残留为 view
  if (mode.value !== 'view') mode.value = 'edit'

  const res = await getOnlyOfficeConfig({ profileId: profileId })
  if (res.code === 200) {
    editorConfig.value = res.data
    dialogVisible.value = true // 打开文档编辑框
  }
}

/* ---------------------------------------------------------------------
 * 4) 统一「能否关闭」判断 —— 返回 true 才允许关闭
 *    - view 模式 / 未就绪：直接关
 *    - 跟踪到脏数据(isDirty)：弹自定义三选一（保存并关闭 / 不保存 / 取消）
 *    - 未跟踪到脏数据：交给 ONLYOFFICE 官方 requestClose() 再核一次，
 *      防止 onDocumentStateChange 漏报导致「有改动却直接关闭丢数据」。
 * ------------------------------------------------------------------- */
const confirmClose = async (): Promise<boolean> => {
  const editor = editorRef.value

  // 查看模式、编辑器未就绪 → 无需确认
  if (mode.value === 'view' || !editor || !editor.getReady()) return true

  // 我们跟踪到有未保存改动 → 自定义确认框
  if (editor.getIsDirty()) {
    try {
      await ElMessageBox.confirm(
        '文档有未保存的更改，是否保存后再关闭？',
        '提示',
        {
          confirmButtonText: '保存并关闭',
          cancelButtonText: '不保存',
          distinguishCancelAndClose: true, // 区分「取消按钮」与「X/ESC」
          type: 'warning'
        }
      )
      // 保存并关闭：必须等保存真正落盘再关（destroy-on-close 会销毁编辑器）
      isSaving.value = true
      const ok = await editor.save()
      isSaving.value = false
      if (!ok) {
        ElMessage.error('保存失败，请检查回调服务后重试')
        return false
      }
      return true
    } catch (action) {
      // 'cancel' = 点了「不保存」→ 允许关闭丢弃
      // 'close'  = 点了 X / ESC → 留在当前页，不关闭
      return action === 'cancel'
    }
  }

  // 未跟踪到脏数据：官方兜底再查一次，防止事件漏报
  // requestClose()：无未保存 → 立即 resolve(true)；有 → 弹原生框，用户确认关闭才 resolve(true)
  return await editor.requestClose()
}

// 点弹框 X / 按 ESC 触发（close-on-click-modal 已关，遮罩不会触发）
const handleBeforeClose = (done: () => void) => {
  if (isSaving.value) { ElMessage.warning('正在保存，请不要关闭'); return }
  confirmClose().then((canClose) => {
    if (canClose) {
      mode.value = 'edit' // 关闭后复位模式，下次打开默认编辑
      done()
    }
  })
}

// 底部「关闭」按钮
const handleClose = async () => {
  if (isSaving.value) { ElMessage.warning('正在保存，请不要关闭'); return }
  const canClose = await confirmClose()
  if (canClose) {
    dialogVisible.value = false
    mode.value = 'edit'
  }
}

// 官方 requestClose 确认关闭后的回调（兜底路径）
const onEditorRequestClose = () => {
  dialogVisible.value = false
  mode.value = 'edit'
}

/* ---------------------------------------------------------------------
 * 5) （可选）若重新启用底部「保存」按钮，handleSave 必须 await，不能用 setTimeout 盲等
 * ------------------------------------------------------------------- */
const handleSave = async () => {
  if (isSaving.value) return
  isSaving.value = true
  ElMessage.info('正在保存，请稍候...')
  try {
    const ok = await editorRef.value?.save()
    if (ok) {
      ElMessage.success('保存成功')
    } else {
      ElMessage.error('保存失败，请检查回调服务')
    }
  } finally {
    isSaving.value = false
  }
}

const onEditorReady = () => {
  ElMessage.success('文档加载成功')
}

const onEditorError = () => {
  ElMessage.error('文档加载失败')
}
