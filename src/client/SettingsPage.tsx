/**
 * 设置页面：基础设置 + 角色专项优化 + 本地规则
 * 注入 DSH 系统设置面板，样式复用 dsw 原生组件，自动适配主题。
 */
import { useMemo, useState } from 'react'
import { useConfig } from '@deepseek-ai/dsh-client-settings'
import { Form, Switch, Select, Input, TextArea, Card, Button, Modal, List } from '@deepseek-ai/dsh-client-ui'
import type { RoleItem } from '../config'

const PRESET_OPTIONS = [
  { id: 'frontend-dev', name: '前端开发工程师' },
  { id: 'backend-dev', name: '后端开发工程师' },
  { id: 'product-manager', name: '产品经理' },
  { id: 'data-analyst', name: '数据分析师' },
  { id: 'copywriter', name: '文案策划' },
  { id: 'general', name: '通用角色' }
]

const emptyForm = { name: '', description: '', rolePrompt: '' }

export const SettingsPage = () => {
  const [config, setConfig] = useConfig()
  const localRules = config.localRules

  const [roleModalVisible, setRoleModalVisible] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null)
  const [formData, setFormData] = useState(emptyForm)

  const allRoleOptions = useMemo(
    () => [...PRESET_OPTIONS, ...(localRules.customRoles || [])],
    [localRules.customRoles]
  )

  const openRoleModal = (role?: RoleItem) => {
    if (role) {
      setEditingRole(role)
      setFormData({ name: role.name, description: role.description, rolePrompt: role.rolePrompt })
    } else {
      setEditingRole(null)
      setFormData(emptyForm)
    }
    setRoleModalVisible(true)
  }

  const saveRole = () => {
    if (!formData.name.trim()) return
    if (editingRole) {
      const updated = localRules.customRoles.map((r: RoleItem) =>
        r.id === editingRole.id ? { ...r, ...formData } : r
      )
      setConfig('localRules.customRoles', updated)
    } else {
      const newRole: RoleItem = { id: 'custom-' + Date.now(), ...formData }
      setConfig('localRules.customRoles', [...(localRules.customRoles || []), newRole])
    }
    setRoleModalVisible(false)
  }

  const deleteRole = (id: string) => {
    const filtered = localRules.customRoles.filter((r: RoleItem) => r.id !== id)
    setConfig('localRules.customRoles', filtered)
    if (localRules.currentRoleId === id) {
      setConfig('localRules.currentRoleId', 'general')
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      {/* ========== 基础设置 ========== */}
      <Card title="基础设置">
        <Form layout="vertical">
          <Form.Item label="优化模式">
            <Select
              value={config.optimizeMode}
              onChange={(v: string) => setConfig('optimizeMode', v)}
              options={[
                { value: 'local', label: '本地规则优化（零成本）' },
                { value: 'llm', label: 'LLM 深度优化（消耗Token）' }
              ]}
            />
          </Form.Item>

          {config.optimizeMode === 'llm' && (
            <>
              <Form.Item label="模型名称" required>
                <Input
                  value={config.llmModel}
                  onChange={(e: any) => setConfig('llmModel', e.target.value)}
                  placeholder="填写 DSH 中已接入的模型名称，如 deepseek-flash"
                />
                <div style={{ fontSize: 12, color: 'var(--dsw-text-secondary, #888)', marginTop: 4 }}>
                  直接复用 DSH 的模型服务，无需额外配置 API Key；留空时自动回退到本地规则优化。
                </div>
              </Form.Item>

              <Form.Item label="模型温度（0-1）">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={config.llmTemperature}
                  onChange={(e: any) => setConfig('llmTemperature', Number(e.target.value))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      {/* ========== 角色专项优化 ========== */}
      <Card title="角色专项优化" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item>
            <Switch
              checked={localRules.enableRoleOptimization}
              onChange={(v: boolean) => setConfig('localRules.enableRoleOptimization', v)}
              label="开启角色专项优化"
            />
            <div style={{ fontSize: 12, color: 'var(--dsw-text-secondary, #888)', marginTop: 4 }}>
              开启后，优化将贴合所选专业角色的视角与术语体系，输出更具针对性的提示词。
            </div>
          </Form.Item>

          {localRules.enableRoleOptimization && (
            <>
              <Form.Item label="选择角色">
                <Select
                  value={localRules.currentRoleId}
                  onChange={(v: string) => setConfig('localRules.currentRoleId', v)}
                  options={allRoleOptions.map((r) => ({ value: r.id, label: r.name }))}
                />
              </Form.Item>

              <Form.Item label="自定义角色">
                <Button type="primary" size="sm" onClick={() => openRoleModal()}>
                  + 添加自定义角色
                </Button>

                {(localRules.customRoles || []).length > 0 && (
                  <List style={{ marginTop: 8 }}>
                    {localRules.customRoles.map((role: RoleItem) => (
                      <List.Item
                        key={role.id}
                        actions={[
                          <Button key="edit" size="xs" onClick={() => openRoleModal(role)}>
                            编辑
                          </Button>,
                          <Button key="del" size="xs" danger onClick={() => deleteRole(role.id)}>
                            删除
                          </Button>
                        ]}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{role.name}</div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--dsw-text-secondary, #888)'
                            }}
                          >
                            {role.description}
                          </div>
                        </div>
                      </List.Item>
                    ))}
                  </List>
                )}
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      {/* ========== 本地优化规则 ========== */}
      <Card title="本地优化规则" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item>
            <Switch
              checked={localRules.cleanWhitespace}
              onChange={(v: boolean) => setConfig('localRules.cleanWhitespace', v)}
              label="自动清理空白字符与空行"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={localRules.filterPoliteWords}
              onChange={(v: boolean) => setConfig('localRules.filterPoliteWords', v)}
              label="过滤客套语气词"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={localRules.normalizeList}
              onChange={(v: boolean) => setConfig('localRules.normalizeList', v)}
              label="统一列表序号格式"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={localRules.splitSections}
              onChange={(v: boolean) => setConfig('localRules.splitSections', v)}
              label="自动识别并拆分语义区块"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={localRules.autoSplitParagraph}
              onChange={(v: boolean) => setConfig('localRules.autoSplitParagraph', v)}
              label="长文本自动分段"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={localRules.appendConstraints}
              onChange={(v: boolean) => setConfig('localRules.appendConstraints', v)}
              label="自动补充约束条件"
            />
            {localRules.appendConstraints && (
              <TextArea
                rows={2}
                value={localRules.constraintsText}
                onChange={(e: any) => setConfig('localRules.constraintsText', e.target.value)}
                placeholder="例如：使用 TypeScript，代码带注释"
                style={{ marginTop: 8 }}
              />
            )}
          </Form.Item>
        </Form>
      </Card>

      {/* ========== 角色编辑弹窗 ========== */}
      <Modal
        title={editingRole ? '编辑角色' : '添加自定义角色'}
        visible={roleModalVisible}
        onOk={saveRole}
        onCancel={() => setRoleModalVisible(false)}
      >
        <Form layout="vertical">
          <Form.Item label="角色名称" required>
            <Input
              value={formData.name}
              onChange={(e: any) => setFormData({ ...formData, name: e.target.value })}
              placeholder="例如：测试工程师"
            />
          </Form.Item>
          <Form.Item label="角色描述">
            <Input
              value={formData.description}
              onChange={(e: any) => setFormData({ ...formData, description: e.target.value })}
              placeholder="一句话描述角色定位"
            />
          </Form.Item>
          <Form.Item label="角色优化提示" required>
            <TextArea
              rows={4}
              value={formData.rolePrompt}
              onChange={(e: any) => setFormData({ ...formData, rolePrompt: e.target.value })}
              placeholder="描述该角色的专业背景、优化偏向、关注维度，例如：你是资深测试工程师，熟悉功能测试、边界用例、异常场景……"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
