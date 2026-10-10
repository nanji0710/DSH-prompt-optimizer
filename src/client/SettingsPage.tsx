/**
 * 设置面板页面（注册在 `settings.section`，kind: list / scope: root）。
 *
 * 全部配置写在浏览器侧 localStorage，与输入框按钮共用同一份状态。
 * 仅使用主题 token（--dsw-alias-*）着色，不引入任何 Harness Client 包。
 *
 * 「AI 接口」一节通过插件自注册的 HTTP 端点读取宿主已注册的 provider 与
 * 每个 provider 支持的模型（含思考强度档位）作为下拉候选；读取失败时
 * 退化为可手填的输入框，不影响保存。
 *
 * ★ 「思考强度」必须做成下拉而不是输入框：档位由模型元数据（reasoning.efforts）
 * 决定，手填一个模型不支持的档位会被宿主在发起请求前直接拒绝，workbuddy 这类
 * 上游还会回 400「模型不支持该思考强度，请调整」。
 */
import { useEffect, useState } from 'react'
import { PRESET_ROLES } from '../config'
import type { RoleItem } from '../config'
import { useConfig, setConfig, resetConfig } from './store'
import { isBridgeReady, requestModels, requestProviders, type ModelInfo, type ProviderInfo } from './bridge'

/**
 * 本地规则开关。
 *
 * ★ v0.3.0：从旧版 7 个清洗/结构开关改为**两级流水线**的 3 个步骤开关。
 * 旧版的「清洗空白与空行」「剔除客套话」「规范列表」「自动分段」
 * 「抽取小节标题」「追加约束条款」已全部移除：实测对短诉求没有增量，
 * 只增加篇幅（见 docs/optimization-directions.md §1.1、§三）。
 */
type RuleKey =
  | 'extractEntities'
  | 'actionOriented'
  | 'applyTemplate'
  | 'enableRoleOptimization'

const RULE_LABELS: Array<[RuleKey, string]> = [
  ['extractEntities', '信息抽取（平台/指标/数据表/约束）'],
  ['actionOriented', '动作导向（改写成"请+动词"开头的指令）'],
  ['applyTemplate', '紧凑重组（按场景套用最匹配的一个模板）'],
  ['enableRoleOptimization', '注入角色行（默认关；开启后只加 1 句）'],
]

const labelStyle: Record<string, string | number> = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, inherit)',
  display: 'block',
  marginBottom: 6,
}

const rowStyle: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary, inherit)',
}

const inputStyle: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-bg-base, transparent)',
  border: '1px solid var(--dsw-alias-border-l2, currentColor)',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
}

const fieldStyle: Record<string, string | number> = { marginBottom: 18 }
const dividerStyle: Record<string, string | number> = {
  height: 1,
  background: 'var(--dsw-alias-border-l2, currentColor)',
  opacity: 0.4,
  margin: '18px 0',
}
const hintStyle: Record<string, string | number> = {
  margin: '6px 0 0',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, inherit)',
}
const sectionTitleStyle: Record<string, string | number> = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, inherit)',
}

const buttonStyle: Record<string, string | number> = {
  ...inputStyle,
  width: 'auto',
  cursor: 'pointer',
}

/** 「AI 接口」一节：模式、provider、模型、思考强度、温度。 */
function ApiSection() {
  const cfg = useConfig()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [defaultSelection, setDefaultSelection] = useState<{ provider?: string; model?: string } | null>(
    null,
  )
  /** 已成功拉取模型的 provider（防止切换 provider 时短暂显示上一个 provider 的档位）。 */
  const [modelsFor, setModelsFor] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const bridgeReady = isBridgeReady()

  useEffect(() => {
    if (!bridgeReady) return
    let alive = true
    void requestProviders().then((result) => {
      if (!alive) return
      setProviders(result.providers)
      setDefaultSelection(result.default)
    })
    return () => {
      alive = false
    }
  }, [bridgeReady])

  const usingLlm = cfg.optimizeMode === 'llm'
  const effectiveProvider = cfg.llmProvider.trim() || defaultSelection?.provider || ''
  const effectiveModel = cfg.llmModel.trim() || defaultSelection?.model || ''

  // provider 变化（或解析出 DSH 默认 provider）后重新拉取模型列表。
  useEffect(() => {
    if (!bridgeReady || !usingLlm || !effectiveProvider) {
      setModels([])
      setModelsFor('')
      return
    }
    let alive = true
    setLoadingModels(true)
    void requestModels(effectiveProvider).then((result) => {
      if (!alive) return
      setModels(result)
      setModelsFor(effectiveProvider)
      setLoadingModels(false)
    })
    return () => {
      alive = false
    }
  }, [bridgeReady, usingLlm, effectiveProvider])

  const modelsReady = modelsFor === effectiveProvider
  const currentModel = modelsReady ? models.find((m) => m.id === effectiveModel) : undefined
  const efforts = currentModel?.reasoning?.efforts ?? []
  const autoEffort = currentModel?.reasoning?.defaultEffort ?? ''

  return (
    <div style={fieldStyle}>
      <h4 style={sectionTitleStyle}>AI 接口</h4>

      <label style={labelStyle}>优化模式</label>
      <select
        style={inputStyle}
        value={cfg.optimizeMode}
        onChange={(e) => setConfig({ optimizeMode: e.target.value as 'local' | 'llm' })}
      >
        <option value="llm">大模型深度改写（推荐）</option>
        <option value="local">本地规则（不调用模型，零成本）</option>
      </select>
      <p style={hintStyle}>
        大模型改写会调用 DSH 已接入的模型接口；调用失败时自动降级为本地规则，不会中断操作。
      </p>

      {usingLlm && (
        <>
          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>接口 / Provider</label>
            <select
              style={inputStyle}
              value={cfg.llmProvider}
              onChange={(e) => setConfig({ llmProvider: e.target.value })}
            >
              <option value="">
                跟随 DSH 默认{defaultSelection?.provider ? `（${defaultSelection.provider}）` : ''}
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.name === provider.id ? '' : `（${provider.id}）`}
                </option>
              ))}
              {/* 已保存但宿主当前未注册的值：保留它，避免下拉 silently 改掉用户配置 */}
              {cfg.llmProvider && !providers.some((p) => p.id === cfg.llmProvider) && (
                <option value={cfg.llmProvider}>{cfg.llmProvider}（宿主未注册）</option>
              )}
            </select>
            <p style={hintStyle}>
              {bridgeReady
                ? `宿主已注册 ${providers.length} 个接口。跟随 DSH 默认时实际使用：${
                    effectiveProvider || '（未解析到）'
                  }`
                : '当前宿主没有可用的 connection 服务，将只能使用本地规则。'}
            </p>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>模型</label>
            <select
              style={inputStyle}
              value={cfg.llmModel}
              onChange={(e) => setConfig({ llmModel: e.target.value })}
            >
              <option value="">
                跟随 DSH 默认{defaultSelection?.model ? `（${defaultSelection.model}）` : ''}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.name === model.id ? '' : `（${model.id}）`}
                </option>
              ))}
              {cfg.llmModel && !models.some((m) => m.id === cfg.llmModel) && (
                <option value={cfg.llmModel}>{cfg.llmModel}（不在当前接口的列表中）</option>
              )}
            </select>
            <p style={hintStyle}>
              {loadingModels
                ? `正在读取 ${effectiveProvider} 的模型列表…`
                : modelsReady && models.length > 0
                  ? (
                      <>
                        当前接口共 {models.length} 个模型。当前生效：
                        {effectiveModel ? <code>{effectiveModel}</code> : '（未解析到模型）'}
                      </>
                    )
                  : (
                      <>
                        未能读取模型列表，可直接使用 DSH 默认。当前生效：
                        {effectiveModel ? <code>{effectiveModel}</code> : '（未解析到模型）'}
                      </>
                    )}
            </p>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>思考强度</label>
            <select
              style={inputStyle}
              value={cfg.llmReasoningEffort}
              onChange={(e) => setConfig({ llmReasoningEffort: e.target.value })}
            >
              <option value="">自动（推荐）{autoEffort ? `：${autoEffort}` : ''}</option>
              {efforts.map((effort) => (
                <option key={effort.id} value={effort.id}>
                  {effort.name}
                  {effort.id === effort.name ? '' : `（${effort.id}）`}
                </option>
              ))}
              {cfg.llmReasoningEffort && !efforts.some((x) => x.id === cfg.llmReasoningEffort) && (
                <option value={cfg.llmReasoningEffort}>
                  {cfg.llmReasoningEffort}（该模型不支持）
                </option>
              )}
            </select>
            <p style={hintStyle}>
              {efforts.length > 0
                ? `可选档位由模型自己声明（${efforts.map((x) => x.id).join(' / ')}）。选「自动」时优先用模型默认档，没有则用最轻一档。`
                : '该模型未声明思考强度档位。选「自动」时不会向接口指定强度，交给它自己的默认行为 —— 指定的档位若不受支持，请求会被直接拒绝。'}
            </p>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>采样温度：{cfg.llmTemperature}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={cfg.llmTemperature}
              style={{ width: '100%' }}
              onChange={(e) => setConfig({ llmTemperature: Number(e.target.value) })}
            />
            <p style={hintStyle}>改写任务建议 0.1–0.3：越低越忠实于原文，越高越发散。</p>
          </div>
        </>
      )}
    </div>
  )
}

/** 「自定义角色」一节：可新增、可编辑、可删除。 */
function RolesSection() {
  const cfg = useConfig()
  const rules = cfg.localRules
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftRole, setDraftRole] = useState<RoleItem | null>(null)

  const startAdd = () => {
    const id = `custom-${Date.now().toString(36)}`
    setEditingId(id)
    setDraftRole({ id, name: '', description: '', rolePrompt: '' })
  }

  const startEdit = (role: RoleItem) => {
    setEditingId(role.id)
    setDraftRole({ ...role })
  }

  const cancel = () => {
    setEditingId(null)
    setDraftRole(null)
  }

  const save = () => {
    if (!draftRole) return
    const name = draftRole.name.trim()
    if (!name) return
    const next: RoleItem = {
      ...draftRole,
      name,
      description: draftRole.description.trim(),
      rolePrompt: draftRole.rolePrompt.trim(),
    }
    const exists = rules.customRoles.some((role) => role.id === next.id)
    const customRoles = exists
      ? rules.customRoles.map((role) => (role.id === next.id ? next : role))
      : [...rules.customRoles, next]
    setConfig({ localRules: { ...rules, customRoles } })
    cancel()
  }

  const remove = (id: string) => {
    setConfig({
      localRules: {
        ...rules,
        customRoles: rules.customRoles.filter((role) => role.id !== id),
        // 删掉的正好是当前选中角色时，回落到通用角色
        currentRoleId: rules.currentRoleId === id ? 'general' : rules.currentRoleId,
      },
    })
    if (editingId === id) cancel()
  }

  return (
    <div style={fieldStyle}>
      <h4 style={sectionTitleStyle}>自定义角色</h4>
      <p style={{ ...hintStyle, marginTop: 0 }}>
        自定义角色用来补充一句回答视角（如「先给结论再给依据」）。可在上方「优化角色」里选中，并开启「注入角色行」后生效。
      </p>

      {rules.customRoles.length === 0 && !draftRole && (
        <p style={{ ...hintStyle }}>暂无自定义角色（内置 {PRESET_ROLES.length} 个）。</p>
      )}

      {rules.customRoles.map((role) => (
        <div key={role.id} style={{ ...rowStyle, alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>
            <strong style={{ color: 'var(--dsw-alias-label-primary, inherit)' }}>{role.name}</strong>
            {role.description !== '' && (
              <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>{role.description}</span>
            )}
          </span>
          <button type="button" style={buttonStyle} onClick={() => startEdit(role)}>
            编辑
          </button>
          <button type="button" style={buttonStyle} onClick={() => remove(role.id)}>
            删除
          </button>
        </div>
      ))}

      {draftRole ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: '1px solid var(--dsw-alias-border-l2, currentColor)',
            borderRadius: 'var(--dsw-radius-sm, 4px)',
          }}
        >
          <label style={labelStyle}>角色名称</label>
          <input
            style={inputStyle}
            value={draftRole.name}
            placeholder="例如：资深 iOS 工程师"
            onChange={(e) => setDraftRole({ ...draftRole, name: e.target.value })}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>角色描述</label>
          <input
            style={inputStyle}
            value={draftRole.description}
            placeholder="例如：侧重 SwiftUI、性能与内存"
            onChange={(e) => setDraftRole({ ...draftRole, description: e.target.value })}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>角色提示词（一句话）</label>
          <input
            style={inputStyle}
            value={draftRole.rolePrompt}
            placeholder="例如：你是一名数据分析师，回答时先给结论再给依据。"
            onChange={(e) => setDraftRole({ ...draftRole, rolePrompt: e.target.value })}
          />
          <p style={hintStyle}>
            只写一句能改变回答行为的话（顺序 / 粒度 / 风格）。写「你是资深 XX 工程师」这类人设对回答质量没有增量，只会占篇幅。
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              style={{ ...buttonStyle, opacity: draftRole.name.trim() === '' ? 0.5 : 1 }}
              disabled={draftRole.name.trim() === ''}
              onClick={save}
            >
              保存角色
            </button>
            <button type="button" style={buttonStyle} onClick={cancel}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...buttonStyle, marginTop: 12 }} onClick={startAdd}>
          ＋ 添加自定义角色
        </button>
      )}
    </div>
  )
}

export function SettingsPage() {
  const cfg = useConfig()
  const rules = cfg.localRules

  return (
    <div style={{ padding: '4px 0 24px', maxWidth: 560 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--dsw-alias-label-primary, inherit)' }}>
        ✨ 提示词优化助手
      </h3>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, inherit)' }}>
        点击输入框右侧的 ✨ 按钮就地优化当前提示词，可用 ↩ 撤销。
      </p>

      <ApiSection />

      <div style={dividerStyle} />

      <div style={fieldStyle}>
        <label style={labelStyle}>优化角色</label>
        <select
          style={inputStyle}
          value={rules.currentRoleId}
          onChange={(e) => setConfig({ localRules: { ...rules, currentRoleId: e.target.value } })}
        >
          <optgroup label="内置角色">
            {PRESET_ROLES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </optgroup>
          {rules.customRoles.length > 0 && (
            <optgroup label="自定义角色">
              {rules.customRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p style={hintStyle}>
          默认不注入角色（数据对账这类任务加人设没有增量）。选中非「通用角色」并开启「注入角色行」后，
          只会在开头加 1 句。
        </p>
      </div>

      <div style={dividerStyle} />

      <RolesSection />

      <div style={dividerStyle} />

      <div style={fieldStyle}>
        <label style={labelStyle}>本地规则</label>
        {RULE_LABELS.map(([key, text]) => (
          <label key={key} style={rowStyle}>
            <input
              type="checkbox"
              checked={Boolean(rules[key])}
              onChange={(e) => setConfig({ localRules: { ...rules, [key]: e.target.checked } })}
            />
            <span>{text}</span>
          </label>
        ))}
        <p style={hintStyle}>
          本地规则只做「信息抽取 + 紧凑重组」，不追加通用套话，输出里不会出现任何占位符。
        </p>
      </div>

      <div style={dividerStyle} />

      <button type="button" style={buttonStyle} onClick={resetConfig}>
        恢复默认配置
      </button>
    </div>
  )
}

export default SettingsPage
