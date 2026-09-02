with open("frontend/src/pages/AiReaderPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

apply_preset_target = """  const applyPreset = (provider: AiProvider) => {
    setBaseUrl(provider.base_url)
    if (provider.models.length) setModel(provider.models[0])
    setTestStatus({ type: 'idle', msg: '' })
    setBalance({ type: 'idle', msg: '' })
    setFetchedModels([])
  }"""
  
apply_preset_replacement = """  const applyPreset = (provider: AiProvider) => {
    const url = provider.base_url.replace(/\\/$/, '')
    setBaseUrl(provider.base_url)
    
    const pcfg = (config as any)?.provider_configs?.[url]
    if (pcfg) {
      setApiKey(pcfg.api_key || '')
      setModel(pcfg.model || provider.models[0] || '')
      setHttpProxy(pcfg.http_proxy || '')
    } else {
      setApiKey('')
      if (provider.models.length) setModel(provider.models[0])
      setHttpProxy('')
    }
    
    setTestStatus({ type: 'idle', msg: '' })
    setBalance({ type: 'idle', msg: '' })
    setFetchedModels([])
  }"""

content = content.replace(apply_preset_target, apply_preset_replacement)

with open("frontend/src/pages/AiReaderPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
