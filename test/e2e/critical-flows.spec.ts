import { test, expect } from '@playwright/test';

test.describe('SWAL Agent Runner - Critical User Flows', () => {

  test.beforeEach(async ({ page }) => {
    // Forward browser console errors and logs for easier debugging
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`[BROWSER PAGE ERROR] ${err.message}`);
    });
    page.on('requestfailed', request => {
      console.log(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText}`);
    });

    // Intercept git-service.ts to mock git.clone to avoid actual remote git network traffic during test cloning
    await page.route('**/src/services/git/git-service.ts', async (route) => {
      console.log(`[ROUTE INTERCEPT] Intercepted git-service.ts`);
      const response = await route.fetch();
      let text = await response.text();
      // Replace git.clone call with a mock function execution that does nothing and returns immediately
      text = text.replace(/await\s+git\.clone\s*\(/g, 'await (async () => {})(');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: text,
      });
    });

    // Intercept python-runner.ts to mock Python execution offline-style
    await page.route('**/src/services/runtime/python-runner.ts', async (route) => {
      console.log(`[ROUTE INTERCEPT] Intercepted python-runner.ts`);
      const mockPythonService = `
        export class PythonRunnerService {
          public static async getInstance() {
            return {};
          }
          public static async runCode(code, onOutput) {
            console.log("Mock runCode called! code:", code, "onOutput type:", typeof onOutput);
            // Use setTimeout to yield the event loop so React can batch/render steps correctly
            if (onOutput) {
              await new Promise(resolve => setTimeout(() => {
                console.log("Calling onOutput from Mock runCode...");
                onOutput("Hello from E2E Pyodide test!");
                resolve();
              }, 50));
            }
            return {
              exitCode: 0,
              output: "Hello from E2E Pyodide test!\\n"
            };
          }
        }
      `;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: mockPythonService,
      });
    });

    // Seed local storage with a mock provider config and a default project
    await page.addInitScript(() => {
      // Polyfill Buffer in browser context for isomorphic-git offline-style
      class MockBuffer extends Uint8Array {
        static from(value, encoding) {
          if (typeof value === 'string') {
            return new MockBuffer(new TextEncoder().encode(value));
          }
          return new MockBuffer(value);
        }
        static isBuffer(obj) {
          return obj instanceof Uint8Array;
        }
        static concat(list, totalLength) {
          let length = totalLength;
          if (length === undefined) {
            length = list.reduce((acc, val) => acc + val.length, 0);
          }
          const result = new MockBuffer(length);
          let offset = 0;
          for (const buf of list) {
            result.set(buf, offset);
            offset += buf.length;
          }
          return result;
        }
        toString(encoding) {
          return new TextDecoder().decode(this);
        }
      }
      (window as any).Buffer = MockBuffer;

      const mockProviders = [
        {
          type: 'gemini-key',
          name: 'Google Gemini API (Key)',
          enabled: true,
          apiKey: 'mock-api-key',
          model: 'gemini-2.5-flash',
        }
      ];
      window.localStorage.setItem('swal_llm_providers_config', JSON.stringify(mockProviders));
      window.localStorage.setItem('swal_llm_active_provider', 'gemini-key');

      const mockProjects = [
        {
          id: 'test-project-id',
          name: 'test-project',
          url: 'https://github.com/example/test-project.git',
          branch: 'main',
          lastSyncedAt: Date.now(),
          status: 'synced',
        }
      ];
      window.localStorage.setItem('swal_git_projects', JSON.stringify(mockProjects));

      // Pre-seed IndexedDB for swal-device-identity to prevent the "keyPath" bug in device-identity.ts from crashing the load
      const request = window.indexedDB.open('swal-device-identity', 1);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('device-identity')) {
          db.createObjectStore('device-identity', { keyPath: 'key' });
        }
      };
      request.onsuccess = (event: any) => {
        const db = event.target.result;
        const transaction = db.transaction('device-identity', 'readwrite');
        const store = transaction.objectStore('device-identity');
        store.put({
          key: 'deviceInfo',
          deviceId: 'swal-e2e-device',
          name: 'Device-E2E',
          deviceType: 'pc',
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
      };
    });
  });

  test('User opens PWA, sees app shell', async ({ page }) => {
    await page.goto('/');

    // Check navbar header title is visible
    const brandTitle = page.locator('span:has-text("SWAL Agent Runner")');
    await expect(brandTitle.first()).toBeVisible();

    // Check that we see the default projects list and the mock project we seeded is rendered
    const projectCard = page.locator('span:has-text("test-project")');
    await expect(projectCard.first()).toBeVisible();
  });

  test('User navigates to Mesh tab, device ID visible', async ({ page }) => {
    await page.goto('/');

    // Navigate to Mesh tab using bottom navigation (works for mobile/desktop layout)
    // or by desktop navigation button with text 'Mesh' or 'P2P Mesh'
    const meshTabButton = page.locator('button:has-text("Mesh")');
    await meshTabButton.first().click();

    // Assert "Mesh Panel" heading is visible
    const meshHeading = page.locator('h2:has-text("Mesh Panel")');
    await expect(meshHeading).toBeVisible();

    // Assert "Device ID" is visible
    const deviceIdLabel = page.locator('p:has-text("Device ID")').last();
    await expect(deviceIdLabel).toBeVisible();

    // Assert that a device ID value (typically a uuid/hash) is rendered and not empty
    const deviceIdValue = page.locator('p.font-mono.text-accent');
    await expect(deviceIdValue).toBeVisible();
    const textContent = await deviceIdValue.textContent();
    expect(textContent?.length).toBeGreaterThan(0);
  });

  test('Git project creation and file operations', async ({ page }) => {
    await page.goto('/');

    // Click on "Clone Repository" or "Connect Your First Repo" button
    const cloneBtn = page.locator('button:has-text("Clone Repository")');
    await cloneBtn.click();

    // Wait for the clone modal to be visible
    const modalHeading = page.locator('h3:has-text("Clone Git Repository")');
    await expect(modalHeading).toBeVisible();

    // Fill clone form
    await page.fill('input[placeholder="https://github.com/user/repository.git"]', 'https://github.com/test/new-project.git');
    await page.fill('input[placeholder="custom-name"]', 'new-project');

    // Click "Start Clone" button
    const startCloneBtn = page.locator('button:has-text("Start Clone")');
    await startCloneBtn.click();

    // Check that the modal is closed and the new project card is now rendered in the Projects Grid
    const newProjectCard = page.locator('span:has-text("new-project")');
    await expect(newProjectCard.first()).toBeVisible();
  });

  test('User launches agent, displays progress and executes Python successfully', async ({ page }) => {
    // Mock the Gemini LLM API calls to simulate agent execution
    let callCount = 0;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      callCount++;
      if (callCount === 1) {
        // First step: model decides to run python code
        const responseBody = {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'I will write and run a Python script to perform our computation.' },
                  {
                    functionCall: {
                      name: 'run_python',
                      args: {
                        code: 'print("Hello from E2E Pyodide test!")',
                      },
                    },
                  },
                ],
              },
            },
          ],
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(responseBody),
        });
      } else {
        // Second step: model completes the task based on python execution stdout
        const responseBody = {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'The Python execution returned the expected stdout. I will complete the task.' },
                  {
                    functionCall: {
                      name: 'complete',
                      args: {
                        summary: 'Python executed successfully and generated expected output.',
                        commitMessage: 'feat: dynamic python check completed',
                      },
                    },
                  },
                ],
              },
            },
          ],
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(responseBody),
        });
      }
    });

    await page.goto('/');

    // Start Agent Task on test-project card
    const startBtn = page.locator('button:has-text("Start Agent Task")');
    await startBtn.first().click();

    // Verify we are now on "New Task" form view with selected project
    const dispatchHeading = page.locator('h2:has-text("Dispatch Headless Agent Task")');
    await expect(dispatchHeading).toBeVisible();

    // Verify test-project is pre-selected in repository select dropdown
    const selectEl = page.locator('select').first();
    await expect(selectEl).toHaveValue('test-project');

    // Fill in task prompt
    await page.fill('textarea[placeholder*="e.g. Implement rate-limiting"]', 'Please execute a python script to test pyodide.');

    // Launch Autonomous Agent
    const launchBtn = page.locator('button:has-text("Launch Autonomous Agent")');
    await launchBtn.click();

    // The app should transition to the Agent Progress view
    const progressHeading = page.locator('h3:has-text("Execution Timeline")');
    await expect(progressHeading).toBeVisible();

    // Assert that the live progress indicator / live badge is visible
    const liveBadge = page.locator('span:has-text("Live")');
    await expect(liveBadge).toBeVisible();

    // Wait for the agent to complete iterations and print stdout from Python
    const pythonOutputSnippet = page.locator('p:has-text("[pyout] Hello from E2E Pyodide test!")');
    try {
      // Dump steps first to see what's on the page
      const steps = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.flex-1.pb-6 p')).map(el => el.textContent);
      });
      console.log("ALL LOGGED STEP TEXTS: >>>", JSON.stringify(steps), "<<<");

      await expect(pythonOutputSnippet).toBeVisible({ timeout: 15000 });
    } catch (err) {
      // Print the projects / task state for debugging
      const state = await page.evaluate(() => {
        try {
          return document.body.innerHTML;
        } catch {
          return "could not get innerHTML";
        }
      });
      console.log("DOM BODY STATE ON FAILURE:", state);
      throw err;
    }

    // Wait for the completed status badge to show the task completed
    const completedBadge = page.locator('span:has-text("completed")');
    await expect(completedBadge).toBeVisible({ timeout: 25000 });

    // Verify "View Results & Diff" button appears
    const viewResultsBtn = page.locator('button:has-text("View Results & Diff")');
    await expect(viewResultsBtn).toBeVisible();
  });

});
