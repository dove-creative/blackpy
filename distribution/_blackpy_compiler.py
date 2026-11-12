"""일반 Python 문법을 캐릭터의 협력 실행 코드로 연결합니다."""

import ast

from blackpy import STATE_NAMES


class ScriptTransformer(ast.NodeTransformer):
    def __init__(self, source, filename):
        self.source = source
        self.filename = filename
        self.allow_await = True

    def error(self, message, node):
        raise SyntaxError(message, (
            self.filename, node.lineno, node.col_offset + 1,
            self.source.splitlines()[node.lineno - 1],
        ))

    def visit_Name(self, node):
        if node.id.startswith("__blackpy_"):
            self.error("__blackpy_로 시작하는 이름은 실행기가 사용해요.", node)
        if node.id in STATE_NAMES:
            if isinstance(node.ctx, ast.Del):
                self.error("캐릭터의 상태는 지울 수 없어요.", node)
            return ast.copy_location(ast.Attribute(
                value=ast.Name(id="__blackpy_actor__", ctx=ast.Load()),
                attr=STATE_NAMES[node.id], ctx=node.ctx,
            ), node)
        return node

    def visit_Call(self, node):
        node = self.generic_visit(node)
        if not self.allow_await:
            return node
        call = ast.Call(
            func=ast.Name(id="__blackpy_call__", ctx=ast.Load()),
            args=[node.func, *node.args], keywords=node.keywords,
        )
        return ast.copy_location(ast.Await(value=ast.copy_location(call, node)), node)

    def checkpoint(self, node):
        return ast.copy_location(ast.Expr(value=ast.Await(value=ast.Call(
            func=ast.Name(id="__blackpy_checkpoint__", ctx=ast.Load()),
            args=[], keywords=[],
        ))), node)

    def visit_FunctionDef(self, node):
        if node.name in STATE_NAMES or node.name.startswith("__blackpy_"):
            self.error("이 이름은 캐릭터의 상태 또는 실행기가 사용해요.", node)
        arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
        arguments += [arg for arg in (node.args.vararg, node.args.kwarg) if arg]
        for argument in arguments:
            if argument.arg in STATE_NAMES or argument.arg.startswith("__blackpy_"):
                self.error("함수 입력값에는 캐릭터 상태와 다른 이름을 사용해 주세요.", argument)

        node = self.generic_visit(node)
        body = node.body
        insertion = 1 if body and isinstance(body[0], ast.Expr) and isinstance(
            body[0].value, ast.Constant
        ) and isinstance(body[0].value.value, str) else 0
        body.insert(insertion, self.checkpoint(node))
        replacement = ast.AsyncFunctionDef(
            name=node.name, args=node.args, body=body,
            decorator_list=node.decorator_list, returns=node.returns,
            type_comment=node.type_comment,
        )
        return ast.copy_location(replacement, node)

    def visit_AsyncFunctionDef(self, node):
        self.error("async def 대신 일반 def로 작성해 주세요.", node)

    def visit_ClassDef(self, node):
        self.error("파일 하나가 캐릭터 하나예요. class 없이 함수를 작성해 주세요.", node)

    def visit_Yield(self, node):
        self.error("이벤트에서는 yield 대신 기다리기를 사용해 주세요.", node)

    visit_YieldFrom = visit_Yield

    def visit_Await(self, node):
        self.error("await 없이 명령을 호출해 주세요.", node)

    def visit_Lambda(self, node):
        if isinstance(node, ast.Lambda):
            arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            arguments += [arg for arg in (node.args.vararg, node.args.kwarg) if arg]
            for argument in arguments:
                if argument.arg in STATE_NAMES or argument.arg.startswith("__blackpy_"):
                    self.error("함수 입력값에는 캐릭터 상태와 다른 이름을 사용해 주세요.", argument)
        previous = self.allow_await
        self.allow_await = False
        try:
            return self.generic_visit(node)
        finally:
            self.allow_await = previous

    def visit_GeneratorExp(self, node):
        return self.visit_Lambda(node)

    def visit_While(self, node):
        node = self.generic_visit(node)
        node.body.insert(0, self.checkpoint(node))
        return node

    visit_For = visit_While

    def visit_AnnAssign(self, node):
        node = self.generic_visit(node)
        if not isinstance(node.target, ast.Name):
            node.simple = 0
        return node

    def visit_NamedExpr(self, node):
        if node.target.id in STATE_NAMES:
            self.error("상태를 바꿀 때에는 := 대신 별도의 대입문을 사용해 주세요.", node)
        return self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.name and (node.name in STATE_NAMES or node.name.startswith("__blackpy_")):
            self.error("오류를 받을 이름은 캐릭터 상태와 다르게 정해 주세요.", node)
        return self.generic_visit(node)

    def visit_Global(self, node):
        node.names = [name for name in node.names if name not in STATE_NAMES]
        return node if node.names else ast.copy_location(ast.Pass(), node)

    visit_Nonlocal = visit_Global

    def visit_Import(self, node):
        for alias in node.names:
            name = alias.asname or alias.name.split(".")[0]
            if name in STATE_NAMES or name.startswith("__blackpy_"):
                self.error("가져올 이름은 캐릭터 상태와 다르게 정해 주세요.", node)
        return node

    def visit_ImportFrom(self, node):
        return self.visit_Import(node)


def compile_script(source, filename):
    tree = ast.parse(source, filename=filename)
    tree = ScriptTransformer(source, filename).visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
