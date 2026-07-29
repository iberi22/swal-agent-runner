# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-flows.spec.ts >> SWAL Agent Runner - Critical User Flows >> User launches agent, displays progress and executes Python successfully
- Location: test/e2e/critical-flows.spec.ts:202:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('p:has-text("[pyout] Hello from E2E Pyodide test!")')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('p:has-text("[pyout] Hello from E2E Pyodide test!")')

```

```yaml
- banner:
  - img
  - text: SWAL Agent Runner PWA Node
  - paragraph: GitCore Protocol v3.9.0
  - navigation:
    - button "Projects":
      - img
      - text: Projects
    - button "New Task":
      - img
      - text: New Task
    - button "Agent Progress":
      - img
      - text: Agent Progress
    - button "Results & Diff":
      - img
      - text: Results & Diff
    - button "Xavier Sync":
      - img
      - text: Xavier Sync
    - button "P2P Mesh":
      - img
      - text: P2P Mesh
  - img
  - text: Xavier Local
  - button "Google Gemini API (Key)":
    - img
    - text: Google Gemini API (Key)
- main:
  - text: "completed Task #20b29bd7"
  - heading "Please execute a python script to test pyodide." [level=2]
  - paragraph: "Repo: test-project · Branch: feature/agent-task · Engine: gemini-2.5-flash"
  - button "View Results & Diff":
    - img
    - text: View Results & Diff
  - heading "Execution Timeline (11 steps)" [level=3]:
    - img
    - text: Execution Timeline (11 steps)
  - img
  - text: Plan 8:02:40 PM
  - img
  - paragraph: Initializing autonomous agent loop for project "test-project"
  - img
  - text: Git 8:02:40 PM
  - img
  - paragraph: "Checked out target branch: feature/agent-task"
  - img
  - text: Plan 8:02:40 PM
  - img
  - paragraph: "Iteration 1/20: Querying LLM provider (Google Gemini API (Key))"
  - img
  - text: Exec 8:02:40 PM run_python
  - img
  - paragraph: "Invoking tool: run_python"
  - img
  - text: Exec 8:02:40 PM run_python
  - img
  - paragraph: Executing Python code (37 chars)...
  - img
  - text: Plan 8:02:40 PM
  - img
  - paragraph: "Iteration 2/20: Querying LLM provider (Google Gemini API (Key))"
  - img
  - text: Exec 8:02:40 PM complete
  - img
  - paragraph: "Invoking tool: complete"
  - img
  - text: Exec 8:02:40 PM complete
  - img
  - paragraph: Task Completed! Python executed successfully and generated expected output.
  - img
  - text: Verify 8:02:40 PM
  - img
  - paragraph: "Agent marked task as complete: Python executed successfully and generated expected output."
  - img
  - text: Git 8:02:40 PM
  - img
  - paragraph: "Committed changes with SHA: cfa85b7a"
  - img
  - text: Memory 8:02:40 PM
  - img
  - paragraph: Saved episodic task memory chunk (0c2fb5a9) to Xavier Node
```

# Test source

```ts
  201 |
  202 |   test('User launches agent, displays progress and executes Python successfully', async ({ page }) => {
  203 |     // Mock the Gemini LLM API calls to simulate agent execution
  204 |     let callCount = 0;
  205 |     await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  206 |       callCount++;
  207 |       if (callCount === 1) {
  208 |         // First step: model decides to run python code
  209 |         const responseBody = {
  210 |           candidates: [
  211 |             {
  212 |               content: {
  213 |                 parts: [
  214 |                   { text: 'I will write and run a Python script to perform our computation.' },
  215 |                   {
  216 |                     functionCall: {
  217 |                       name: 'run_python',
  218 |                       args: {
  219 |                         code: 'print("Hello from E2E Pyodide test!")',
  220 |                       },
  221 |                     },
  222 |                   },
  223 |                 ],
  224 |               },
  225 |             },
  226 |           ],
  227 |         };
  228 |         await route.fulfill({
  229 |           status: 200,
  230 |           contentType: 'application/json',
  231 |           body: JSON.stringify(responseBody),
  232 |         });
  233 |       } else {
  234 |         // Second step: model completes the task based on python execution stdout
  235 |         const responseBody = {
  236 |           candidates: [
  237 |             {
  238 |               content: {
  239 |                 parts: [
  240 |                   { text: 'The Python execution returned the expected stdout. I will complete the task.' },
  241 |                   {
  242 |                     functionCall: {
  243 |                       name: 'complete',
  244 |                       args: {
  245 |                         summary: 'Python executed successfully and generated expected output.',
  246 |                         commitMessage: 'feat: dynamic python check completed',
  247 |                       },
  248 |                     },
  249 |                   },
  250 |                 ],
  251 |               },
  252 |             },
  253 |           ],
  254 |         };
  255 |         await route.fulfill({
  256 |           status: 200,
  257 |           contentType: 'application/json',
  258 |           body: JSON.stringify(responseBody),
  259 |         });
  260 |       }
  261 |     });
  262 |
  263 |     await page.goto('/');
  264 |
  265 |     // Start Agent Task on test-project card
  266 |     const startBtn = page.locator('button:has-text("Start Agent Task")');
  267 |     await startBtn.first().click();
  268 |
  269 |     // Verify we are now on "New Task" form view with selected project
  270 |     const dispatchHeading = page.locator('h2:has-text("Dispatch Headless Agent Task")');
  271 |     await expect(dispatchHeading).toBeVisible();
  272 |
  273 |     // Verify test-project is pre-selected in repository select dropdown
  274 |     const selectEl = page.locator('select').first();
  275 |     await expect(selectEl).toHaveValue('test-project');
  276 |
  277 |     // Fill in task prompt
  278 |     await page.fill('textarea[placeholder*="e.g. Implement rate-limiting"]', 'Please execute a python script to test pyodide.');
  279 |
  280 |     // Launch Autonomous Agent
  281 |     const launchBtn = page.locator('button:has-text("Launch Autonomous Agent")');
  282 |     await launchBtn.click();
  283 |
  284 |     // The app should transition to the Agent Progress view
  285 |     const progressHeading = page.locator('h3:has-text("Execution Timeline")');
  286 |     await expect(progressHeading).toBeVisible();
  287 |
  288 |     // Assert that the live progress indicator / live badge is visible
  289 |     const liveBadge = page.locator('span:has-text("Live")');
  290 |     await expect(liveBadge).toBeVisible();
  291 |
  292 |     // Wait for the agent to complete iterations and print stdout from Python
  293 |     const pythonOutputSnippet = page.locator('p:has-text("[pyout] Hello from E2E Pyodide test!")');
  294 |     try {
  295 |       // Dump steps first to see what's on the page
  296 |       const steps = await page.evaluate(() => {
  297 |         return Array.from(document.querySelectorAll('.flex-1.pb-6 p')).map(el => el.textContent);
  298 |       });
  299 |       console.log("ALL LOGGED STEP TEXTS: >>>", JSON.stringify(steps), "<<<");
  300 |
> 301 |       await expect(pythonOutputSnippet).toBeVisible({ timeout: 15000 });
      |                                         ^ Error: expect(locator).toBeVisible() failed
  302 |     } catch (err) {
  303 |       // Print the projects / task state for debugging
  304 |       const state = await page.evaluate(() => {
  305 |         try {
  306 |           return document.body.innerHTML;
  307 |         } catch {
  308 |           return "could not get innerHTML";
  309 |         }
  310 |       });
  311 |       console.log("DOM BODY STATE ON FAILURE:", state);
  312 |       throw err;
  313 |     }
  314 |
  315 |     // Wait for the completed status badge to show the task completed
  316 |     const completedBadge = page.locator('span:has-text("completed")');
  317 |     await expect(completedBadge).toBeVisible({ timeout: 25000 });
  318 |
  319 |     // Verify "View Results & Diff" button appears
  320 |     const viewResultsBtn = page.locator('button:has-text("View Results & Diff")');
  321 |     await expect(viewResultsBtn).toBeVisible();
  322 |   });
  323 |
  324 | });
  325 |
```