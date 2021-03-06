import * as vscode from 'vscode';
import { TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { loadFakeTests, runFakeTests, runNode } from './fakeTests';
import { TestInfo, TestSuiteInfo } from 'vscode-test-adapter-api';

/**
 * This class is intended as a starting point for implementing a "real" TestAdapter.
 * The file `README.md` contains further instructions.
 */
export class ExampleAdapter implements TestAdapter {

	private disposables: { dispose(): void }[] = [];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();

	private nodesById = new Map<string, TestSuiteInfo | TestInfo>();

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {

		this.log.info('Initializing example adapter');

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);

	}

	async load(): Promise<void> {

		this.log.info('Loading example tests');

		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });

		const loadedTests = await loadFakeTests();
		this.nodesById.clear();
		this.collectNodesById(loadedTests)

		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: loadedTests });

	}

	async run(tests: string[]): Promise<void> {

		this.log.info(`Running example tests ${JSON.stringify(tests)}`);

		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		for (const suiteOrTestId of tests) {
			const node = this.nodesById.get(suiteOrTestId);
			if (node) {
				await runNode(node, this.testStatesEmitter)
			}
		}
		// in a "real" TestAdapter this would start a test run in a child process
		

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });

	}

/*	implement this method if your TestAdapter supports debugging tests
	async debug(tests: string[]): Promise<void> {
		// start a test run in a child process and attach the debugger to it...
	}
*/

	private collectNodesById(info: TestSuiteInfo | TestInfo): void {
		this.nodesById.set(info.id, info);
		if (info.type === 'suite') {
			for (const child of info.children) {
				this.collectNodesById(child);
			}
		}
	}

	cancel(): void {
		// in a "real" TestAdapter this would kill the child process for the current test run (if there is any)
		throw new Error("Method not implemented.");
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}
