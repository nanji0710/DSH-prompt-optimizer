/**
 * 设置页面：暂为静态说明（客户端 v0.1.2 只依赖 react，配置读写后续版本接入）。
 */
export function SettingsPage() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, color: '#333' }}>
      <h3 style={{ marginTop: 0 }}>✨ 提示词优化助手</h3>
      <p>
        输入框左侧的 <b>✨</b> 按钮一键优化提示词。
      </p>
      <ul>
        <li>本地规则引擎：零成本，自动去客套、结构化、补边界。</li>
        <li>角色化优化：前端、后端、产品、数据分析等 6 个内置角色。</li>
        <li>LLM 深度优化（需在服务端配置模型）：调用已接入的模型做精细润色。</li>
      </ul>
      <p style={{ color: '#888', fontSize: 13 }}>
        配置项（角色选择、优化模式）将在后续版本开放到设置面板。
      </p>
    </div>
  )
}
