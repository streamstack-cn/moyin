def _build_evolve_system_prompt(cfg):
    parts = _build_persona_lines(cfg) + [
        "",
        "核心任务：",
        "这里有一份你之前生成的结构化阅读报告，以及读者在此基础上与你进行的探讨对话。",
        "请你像一位严谨的编辑，把对话中产生的新见解、新结论，无缝融入到原有报告的各个模块中（如核心收获、个人思考、知识关联等）。",
        "要求：",
        "1. 保持原有报告的深度与语气。",
        "2. 必须严格遵守原始报告的 JSON 格式输出，不要破坏未涉及部分的原始信息。",
        "3. 只输出合并后的最新 JSON，不要输出任何其他内容。"
    ]
    return "\n".join(parts)

def _build_evolve_user_prompt(report_json, chat_messages):
    report_str = json.dumps(report_json, ensure_ascii=False, indent=2)
    chat_str = "\n".join([f"[{m.get('role')}]: {m.get('content')}" for m in chat_messages])
    return (
        "【原始报告 JSON】\n"
        f"{report_str}\n\n"
        "【探讨对话历史】\n"
        f"{chat_str}\n\n"
        "请结合以上对话，输出升级后的 JSON 报告："
    )
