import * as vscode from 'vscode';
import * as path from "path";
import cp = require('child_process');
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { GoDocumentSymbolProvider } from './goOutline';
import { LineBuffer } from './utils';
const {chunksToLinesAsync, chomp} = require('@rauschma/stringio');
const fs = require('fs').promises

const fakeTestSuite: TestSuiteInfo = {
	type: 'suite',
	id: 'root',
	label: 'Fake', // the label of the root node should be the name of the testing framework
	children: [
		{
			type: 'suite',
			id: 'nested',
			label: 'Nested suite',
			children: [
				{
					type: 'test',
					id: 'test1',
					label: 'Test #1'
				},
				{
					type: 'test',
					id: 'test2',
					label: 'Test #2'
				}
			]
		},
		{
			type: 'test',
			id: 'test3',
			label: 'Test #3'
		},
		{
			type: 'test',
			id: 'test4',
			label: 'Test #4'
		}
	]
};

export function loadFakeTests(): Promise<TestSuiteInfo> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file')[0];
	if (workspaceFolder != null) {
		let srcLocation = workspaceFolder?.uri.path;
		const uri = vscode.Uri.file(srcLocation);
		return Promise.resolve<TestSuiteInfo>(discoverTests(uri));	
	} else {
		return Promise.resolve<TestSuiteInfo>(fakeTestSuite);
	}
}

function getTestFunctions(uri: vscode.Uri) {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(uri)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& (sym.name.startsWith('Test'))
			)
		);
}

async function walk(dir: string, fileList: TestSuiteInfo = {type: "suite", id: "root", label: "Root", children: []}): Promise<TestSuiteInfo> {
	 const files = await fs.readdir(dir);
	for (const file of files) {
		const stat = await fs.stat(path.join(dir, file));
		
	 	if (stat.isDirectory()) {
			let child: TestSuiteInfo = {
				type: "suite",
				id: `${fileList.id}_${file}`,
				label: file,
				children: []
			};
			child = await walk(path.join(dir, file), child);
			if (child.children.length > 0) {
				fileList.children.push(child);
			}
		 } else {
			if (file.endsWith("_test.go")) {
				let symbols = await getTestFunctions(vscode.Uri.file(path.join(dir, file)))
				let suiteTests = symbols.filter((s) => s.name.endsWith("Suite"));
				let suiteTest = ""
				if (suiteTests.length > 0) {
					suiteTest = suiteTests[0].name;
				}
				symbols = symbols.filter((s) => !s.name.endsWith("Suite"));
				symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
				let children: TestInfo[] = symbols.map(symbol => {
					return {
					type: "test",
					description: suiteTest,
					id: `${fileList.id}_${suiteTest.length > 0 ? suiteTest : file}_${symbol.name}`,
					label: symbol.name,
					file: path.join(dir, file)
				};
						});
				fileList.children.push(
				{
					type: 'suite',
					id: path.join(dir, file),
					label: suiteTest.length > 0 ? suiteTest : file,
					children: children
				}
			)}
		 }
	}
	return fileList;
}



async function discoverTests(uri: vscode.Uri): Promise<TestSuiteInfo> {
	return walk(uri.fsPath);
}

export async function runFakeTests(
	tests: string[],
	testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
): Promise<void> {
	for (const suiteOrTestId of tests) {
		const node = findNode(fakeTestSuite, suiteOrTestId);
		if (node) {
			await runNode(node, testStatesEmitter);
		}
	}
}

function findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
	if (searchNode.id === id) {
		return searchNode;
	} else if (searchNode.type === 'suite') {
		for (const child of searchNode.children) {
			const found = findNode(child, id);
			if (found) return found;
		}
	}
	return undefined;
}

export async function runNode(
	node: TestSuiteInfo | TestInfo,
	testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file')[0];
	if (node.type === 'suite') {

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

		for (const child of node.children) {
			await runNode(child, testStatesEmitter);
		}

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

	} else { // node.type === 'test'

		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

		let args: Array<string> = ['test', '-v', '-run', `^(${node.label})$`, path.dirname(node.file ?? "")];

		let goRuntimePath = '/usr/local/bin/go';

		console.log(`Running tool: ${goRuntimePath} ${args.join(' ')}`)

		let tp = cp.spawn(goRuntimePath, args, {
			cwd: workspaceFolder?.uri.fsPath, 
			stdio: ['ignore', 'pipe', 'pipe']
		});

		await echoReadable(tp.stdout);
		
		// const packageResultLineRE = /^(--- FAIL:)[ \t]+(.+?)[ \t]+(\([0-9\.]+s\)|\(cached\))/; // 1=ok/FAIL, 2=package, 3=time/(cached)
		// 	//const packageResultLineRE = /^(ok|FAIL)[ \t]+(.+?)[ \t]+([0-9\.]+s|\(cached\))/; // 1=ok/FAIL, 2=package, 3=time/(cached)
		// 	const testResultLines: string[] = [];
		// 	const failedTests: string[] = [];
		// 	const processTestResultLine = (line: string) => {
		// 		testResultLines.push(line);
		// 		const result = line.match(packageResultLineRE);
		// 		if (result) {
		// 			failedTests.push(result[2]);
		// 		}
		// 	};

		// outBuf.onLine(line => processTestResultLine(line));
		// outBuf.onDone(last => {
		// 	if (last) processTestResultLine(last);

		// 	// If there are any remaining test result lines, emit them to the output channel.
		// 	if (testResultLines.length > 0) {
		// 		//testResultLines.forEach(line => outputChannel.appendLine(line));
		// 	}
		// });

		// // go test emits build errors on stderr, which contain paths relative to the cwd
		// //errBuf.onLine(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
		// //errBuf.onDone(last => last && outputChannel.appendLine(expandFilePathInOutput(last, testconfig.dir)));

		// tp.stdout.on('data', chunk => outBuf.append(chunk.toString()));
		// tp.stderr.on('data', chunk => errBuf.append(chunk.toString()));



		// tp.on('close', (code, signal) => {
		// 	outBuf.done();
		// 	errBuf.done();

		// 	if (code) {
		// 		//outputChannel.appendLine(`Error: ${testType} failed.`);
		// 	//} else if (signal === sendSignal) {
		// 		//outputChannel.appendLine(`Error: ${testType} terminated by user.`);
		// 	} else {
		// 		//outputChannel.appendLine(`Success: ${testType} passed.`);
		// 	}

		// 	// let index = runningTestProcesses.indexOf(tp, 0);
		// 	// if (index > -1) {
		// 	// 	runningTestProcesses.splice(index, 1);
		// 	// }



		// 	//resolve(new RawTestResult(code === 0, testResultLines, failedTests));
		// });

		// //runningTestProcesses.push(tp);

		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'passed' });

	}
}

async function echoReadable(readable: any) {
	for await (const line of chunksToLinesAsync(readable)) {
		let myLine = chomp(line)
		console.log('LINE: '+ myLine);
	}
}