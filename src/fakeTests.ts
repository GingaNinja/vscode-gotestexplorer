import * as vscode from 'vscode';
import * as path from "path";
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { GoDocumentSymbolProvider } from './goOutline';
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
				id: file,
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

				symbols = symbols.sort((a, b) => a.name.localeCompare(b.name));
				let children: TestInfo[] = symbols.map(symbol => {
					return {
					type: "test",
					id: `${file}_${symbol.name}`,
					label: symbol.name,
					file: path.join(dir, file)
				};
						});
				fileList.children.push(
				{
					type: 'suite',
					id: path.join(dir, file),
					label: file,
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

async function runNode(
	node: TestSuiteInfo | TestInfo,
	testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
): Promise<void> {

	if (node.type === 'suite') {

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

		for (const child of node.children) {
			await runNode(child, testStatesEmitter);
		}

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

	} else { // node.type === 'test'

		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'passed' });

	}
}
