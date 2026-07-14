import { Type } from 'typebox'

const WINDMILL_URL = process.env.WINDMILL_URL || 'http://ape:3900'
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN || ''

function checkToken() {
	if (!WINDMILL_TOKEN) throw new Error('WINDMILL_TOKEN 未配置')
}

async function runWindmill(script, body) {
	checkToken()
	const res = await fetch(`${WINDMILL_URL}/api/w/default/jobs/run/p/${script}`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${WINDMILL_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})
	const text = (await res.text()).trim()
	if (!/^[0-9a-f-]{36}$/.test(text)) {
		let msg = text
		try { const e = JSON.parse(text); msg = e.error || e.message || text } catch {}
		throw new Error(`Windmill 提交失败: ${msg}`)
	}
	const jobId = text
	for (let i = 0; i < 60; i++) {
		const r = await fetch(`${WINDMILL_URL}/api/w/default/jobs/completed/get/${jobId}`, {
			headers: { 'Authorization': `Bearer ${WINDMILL_TOKEN}` },
		})
		const text = await r.text()
		let data
		try { data = JSON.parse(text) } catch {
			await new Promise((resolve) => setTimeout(resolve, 1000))
			continue
		}
		if (data.success === true) return JSON.stringify(data.result, null, 2)
		if (data.success === false) throw new Error(data.result?.error?.message || 'unknown error')
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
	throw new Error('Windmill job timeout')
}

export default function (pi) {
	pi.registerTool({
		name: 'qdrant_search',
		label: '教材语义搜索',
		promptSnippet: '搜索教材内容（语义搜索），快速定位知识点、课文、人物所在的教材和页码',
		description: '搜索教材内容（Qdrant 语义搜索），返回命中的教材页面及完整文本。轻量快速，用于快速定位问题涉及哪本书、哪一页。如果返回的文本不足以回答问题，再使用 pageindex-content 加载更多上下文。',
		promptGuidelines: [
			'当用户询问教材中的知识点、课文、人物、定义、例题时，优先使用 qdrant_search 搜索教材内容',
			'qdrant_search 是语义搜索，适合模糊表述的问题',
			'如果 qdrant_search 结果不理想，再尝试 es_search（关键词精确匹配）',
		],
		parameters: Type.Object({
			query: Type.String({ description: '搜索内容，如《平面向量的数量积》《热力学第二定律》《牛顿定律》' }),
			top_k: Type.Optional(Type.Number({ description: '最多返回几条结果', default: 5 })),
			book: Type.Optional(Type.String({ description: '限定单书，如 教材/物理/物理必修第一册' })),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const body = { query: params.query, top_k: params.top_k || 5 }
			if (params.book) body.book_name = params.book
			const result = await runWindmill('f/query/qdrant_search', body)
			return { content: [{ type: 'text', text: result }], details: {} }
		},
	})

	pi.registerTool({
		name: 'pageindex_content',
		label: '教材内容加载',
		promptSnippet: '获取教材指定页范围的文本内容（需要先定位到教材和页码）',
		description: '获取教材指定页的文本内容。在 pageindex-structure 定位到相关章节的页范围后，用此工具精确获取该范围的文本。支持范围如 "17-18"、单页 "17"、多段 "17,19"。',
		promptGuidelines: [
			'在 qdrant_search 定位到具体教材和页码后，如需更多上下文（如跨页内容、完整例题），使用此工具',
			'支持页范围，如 "17-18" 表示第17到18页',
		],
		parameters: Type.Object({
			book_id: Type.String({ description: '教材标识，如 教材/数学/数学(A版)必修第二册' }),
			pages: Type.String({ description: '页范围，如 "17-18"（第17到18页）、"17"（单页）、"17,19"（第17和19页）' }),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const result = await runWindmill('f/query/pageindex_content', {
				book_id: params.book_id,
				pages: params.pages,
			})
			return { content: [{ type: 'text', text: result }], details: {} }
		},
	})

	pi.registerTool({
		name: 'pageindex_structure',
		label: '教材章节结构',
		promptSnippet: '获取教材的章节树结构（标题、摘要、页范围，不含文本）',
		description: '获取教材的树结构（仅标题、摘要、页范围，不含文本）。轻量快速，用于在 qdrant-search 定位到某本书后，进一步查看该书的章节结构，找到相关章节的页范围。然后使用 pageindex-content 获取具体页的文本。',
		promptGuidelines: [
			'在 qdrant_search 定位到某本书后，如需查看章节树结构，使用此工具',
			'此工具只返回结构信息（标题、摘要、页范围），不含实际文本内容',
		],
		parameters: Type.Object({
			book_id: Type.String({ description: '教材标识，如 教材/数学/数学(A版)必修第二册' }),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const result = await runWindmill('f/query/pageindex_structure', {
				book_id: params.book_id,
			})
			return { content: [{ type: 'text', text: result }], details: {} }
		},
	})

	pi.registerTool({
		name: 'es_search',
		label: '教材关键词搜索',
		promptSnippet: '搜索教材内容（关键词精确匹配），与 qdrant_search 互补',
		description: '搜索教材内容（ES 全文检索，IK 中文分词），返回命中的教材页面及完整文本。擅长精确关键词匹配，与 qdrant-search（语义搜索）互补。当 qdrant-search 结果不理想时，可尝试此工具。',
		promptGuidelines: [
			'当 qdrant-search 结果不理想，或需要精确关键词匹配时，使用此工具',
			'ES 擅长精确术语匹配，如"动量守恒定律""牛顿第一定律"等专有名词',
		],
		parameters: Type.Object({
			query: Type.String({ description: '搜索内容，如 动量守恒定律、牛顿第一定律' }),
			top_k: Type.Optional(Type.Number({ description: '最多返回几条结果', default: 5 })),
			book: Type.Optional(Type.String({ description: '限定单书，如 教材/物理/物理选择性必修第一册' })),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const body = { query: params.query, top_k: params.top_k || 5 }
			if (params.book) body.book_name = params.book
			const result = await runWindmill('f/query/es_search', body)
			return { content: [{ type: 'text', text: result }], details: {} }
		},
	})
}
