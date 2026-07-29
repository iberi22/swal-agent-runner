use wasm_bindgen::prelude::*;
use serde_json::json;

#[wasm_bindgen]
pub struct GestaltEngine {}

#[wasm_bindgen]
impl GestaltEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        GestaltEngine {}
    }

    #[wasm_bindgen(js_name = executeRunSpec)]
    pub fn execute_run_spec(&self, spec: JsValue) -> JsValue {
        let spec_val: serde_json::Value = match serde_wasm_bindgen::from_value(spec) {
            Ok(v) => v,
            Err(_) => serde_json::Value::Null,
        };

        let task = spec_val.get("task").and_then(|t| t.as_str()).unwrap_or("Unknown Task").to_string();
        let base_ref = spec_val.get("base_ref").and_then(|b| b.as_str()).unwrap_or("main").to_string();

        let empty_vec = vec![];
        let agents_arr = spec_val.get("agents").and_then(|a| a.as_array()).unwrap_or(&empty_vec);

        let mut results = vec![];
        for agent in agents_arr {
            let agent_id = agent.get("id").and_then(|i| i.as_str()).unwrap_or("unknown_agent").to_string();
            results.push(json!({
                "agent_id": agent_id,
                "output": format!("[WASM] Agent \"{}\" task: {}", agent_id, if task.len() > 60 { &task[0..60] } else { &task }),
                "branch": format!("feature/{}", agent_id),
                "changed_files": vec![format!("src/agents/{}.ts", agent_id)],
                "duration_ms": 0,
            }));
        }

        let run_id = uuid::Uuid::new_v4().to_string();
        let duration_ms = agents_arr.len() * 50;

        let report = json!({
            "run_id": run_id,
            "task": task,
            "agents": results,
            "duration_ms": duration_ms,
            "merged_branches": vec![base_ref],
            "conflicts": Vec::<String>::new(),
            "events_path": format!("/memory/events/gestalt/{}", run_id),
            "success": true,
        });

        serde_wasm_bindgen::to_value(&report).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen(js_name = subscribeEvents)]
    pub fn subscribe_events(&self) -> WasmEventStream {
        let ts = js_sys::Date::now();
        let events = vec![
            json!({
                "type": "engine_initialized",
                "data": { "timestamp": ts }
            }).to_string(),
            json!({
                "type": "execution_ready",
                "data": { "ready": true }
            }).to_string(),
        ];
        WasmEventStream { events, index: 0 }
    }
}

#[wasm_bindgen]
pub struct WasmEventStream {
    events: Vec<String>,
    index: usize,
}

#[wasm_bindgen]
impl WasmEventStream {
    pub fn next(&mut self) -> Option<String> {
        if self.index < self.events.len() {
            let event = self.events[self.index].clone();
            self.index += 1;
            Some(event)
        } else {
            None
        }
    }
}

#[wasm_bindgen]
pub struct WasmGraph {
    nodes: Vec<JsValue>,
    edges: Vec<JsValue>,
}

#[wasm_bindgen]
impl WasmGraph {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        WasmGraph {
            nodes: Vec::new(),
            edges: Vec::new(),
        }
    }

    #[wasm_bindgen(js_name = addNode)]
    pub fn add_node(&mut self, node: JsValue) {
        self.nodes.push(node);
    }

    #[wasm_bindgen(js_name = addEdge)]
    pub fn add_edge(&mut self, edge: JsValue) {
        self.edges.push(edge);
    }

    #[wasm_bindgen(js_name = getNodes)]
    pub fn get_nodes(&self) -> Vec<JsValue> {
        self.nodes.clone()
    }

    #[wasm_bindgen(js_name = getEdges)]
    pub fn get_edges(&self) -> Vec<JsValue> {
        self.edges.clone()
    }
}

#[wasm_bindgen]
pub struct WasmEventBus {
    callback: Option<js_sys::Function>,
}

#[wasm_bindgen]
impl WasmEventBus {
    #[wasm_bindgen(constructor)]
    pub fn new(callback: Option<js_sys::Function>) -> Self {
        WasmEventBus { callback }
    }

    pub fn publish(&self, event: &str) {
        if let Some(ref cb) = self.callback {
            let this = JsValue::NULL;
            let arg = JsValue::from_str(event);
            let _ = cb.call1(&this, &arg);
        }
    }
}

#[wasm_bindgen]
pub struct RunSpec {
    base_ref: String,
    task: String,
    agents: Vec<JsValue>,
    max_parallel: usize,
    timeout: usize,
    push: bool,
    integration_branch: Option<String>,
}

#[wasm_bindgen]
impl RunSpec {
    #[wasm_bindgen(constructor)]
    pub fn new(
        base_ref: String,
        task: String,
        agents: Vec<JsValue>,
        max_parallel: usize,
        timeout: usize,
        push: bool,
        integration_branch: Option<String>,
    ) -> Self {
        RunSpec {
            base_ref,
            task,
            agents,
            max_parallel,
            timeout,
            push,
            integration_branch,
        }
    }

    pub fn agents(&self) -> Vec<JsValue> {
        self.agents.clone()
    }
}

#[wasm_bindgen]
pub struct AgentSpec {
    pub_id: String,
    pub_command: String,
    pub_args: Vec<String>,
}

#[wasm_bindgen]
impl AgentSpec {
    #[wasm_bindgen(constructor)]
    pub fn new(id: String, command: String, args: Vec<String>) -> Self {
        AgentSpec {
            pub_id: id,
            pub_command: command,
            pub_args: args,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.pub_id.clone()
    }

    #[wasm_bindgen(setter)]
    pub fn set_id(&mut self, id: String) {
        self.pub_id = id;
    }

    #[wasm_bindgen(getter)]
    pub fn command(&self) -> String {
        self.pub_command.clone()
    }

    #[wasm_bindgen(setter)]
    pub fn set_command(&mut self, command: String) {
        self.pub_command = command;
    }

    #[wasm_bindgen(getter)]
    pub fn args(&self) -> Vec<String> {
        self.pub_args.clone()
    }

    #[wasm_bindgen(setter)]
    pub fn set_args(&mut self, args: Vec<String>) {
        self.pub_args = args;
    }
}
