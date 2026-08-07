import * as ts from "typescript";

export function isServerActionModule(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === "use server") return true;
    } else {
      break;
    }
  }
  return false;
}

export function scanServerActionExports(sourceFile: ts.SourceFile) {
  const invalidExports: { name: string; kind: string; line: number }[] = [];

  function addInvalid(node: ts.Node, name: string, kind: string) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    invalidExports.push({ name, kind, line: line + 1 });
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      if (!stmt.exportClause) {
        addInvalid(stmt, "*", "wildcard re-export");
      } else if (ts.isNamedExports(stmt.exportClause)) {
        for (const element of stmt.exportClause.elements) {
          if (element.isTypeOnly) continue;
          addInvalid(element, element.name.text, "ambiguous named re-export");
        }
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      if (ts.isFunctionDeclaration(stmt.expression) || ts.isFunctionExpression(stmt.expression) || ts.isArrowFunction(stmt.expression)) {
        const hasAsync = ts.canHaveModifiers(stmt.expression) && ts.getModifiers(stmt.expression)?.some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword);
        if (!hasAsync) addInvalid(stmt.expression, "default", "non-async function");
      } else {
        addInvalid(stmt.expression, "default", "unprovable default export");
      }
      continue;
    }

    if (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
        continue;
      }
      if (ts.isFunctionDeclaration(stmt)) {
        const hasAsync = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword);
        if (!hasAsync) {
          addInvalid(stmt, stmt.name?.text || "default", "synchronous function");
        }
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!decl.initializer) {
            addInvalid(decl, decl.name.getText(), "uninitialized variable");
            continue;
          }
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            const hasAsync = ts.canHaveModifiers(decl.initializer) && ts.getModifiers(decl.initializer)?.some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword);
            if (!hasAsync) {
              addInvalid(decl, decl.name.getText(), "non-async arrow function");
            }
          } else {
            addInvalid(decl, decl.name.getText(), ts.SyntaxKind[decl.initializer.kind]);
          }
        }
      } else if (ts.isClassDeclaration(stmt)) {
        addInvalid(stmt, stmt.name?.text || "default", "class");
      } else if (ts.isEnumDeclaration(stmt)) {
        addInvalid(stmt, stmt.name?.text || "default", "enum");
      } else {
        let name = "unknown";
        if ("name" in stmt && stmt.name && ts.isIdentifier(stmt.name as ts.Node)) {
          name = (stmt.name as ts.Identifier).text;
        }
        addInvalid(stmt, name, ts.SyntaxKind[stmt.kind]);
      }
    }
  }

  return invalidExports;
}
