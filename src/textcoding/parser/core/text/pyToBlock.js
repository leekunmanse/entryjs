/*
 *
 */
'use strict';

Entry.PyToBlockParser = function(blockSyntax) {
    this._type = 'PyToBlockParser';
    this.dic = blockSyntax['#dic'];
    this.blockSyntax = blockSyntax;

    this._funcParamMap = {};
    this._funcMap = {};

    this._isInFuncDef = false;
};

(function(p) {
    p.util = Entry.TextCodingUtil;

    p.binaryOperator = {
        '==': 'EQUAL',
        '>': 'GREATER',
        '<': 'LESS',
        '>=': 'GREATER_OR_EQUAL',
        '<=': 'LESS_OR_EQUAL',
    };

    p.arithmeticOperator = {
        '+': 'PLUS',
        '-': 'MINUS',
        '*': 'MULTI',
        '/': 'DIVIDE',
    };

    p.divideOperator = {
        '//': 'QUOTIENT',
        '%': 'MOD',
    };

    p.logicalOperator = {
        '&&': 'AND',
        '||': 'OR',
    };

    p.Programs = function(astArr) {
        try {
            return this.processPrograms(astArr);
        } catch (error) {
            var err = {};
            err.title = error.title;
            err.message = error.message;
            err.line = error.line;
            throw err;
        }
    };

    p.processPrograms = function(astArr) {
        this.createFunctionMap();
        this._funcParamMap = {};
        this._isInFuncDef = false;
        var ws = Entry.playground.mainWorkspace;
        if (ws && !ws.board.code) return [];
        this.object = ws ? ws.board.code.object : Entry.playground.object;

        var result;
        if (!astArr[0]) return [];
        var astArrBody = astArr[0].body;
        var hasVariable =
            astArrBody &&
            astArrBody[0] &&
            astArrBody[0].type === 'ExpressionStatement' &&
            astArrBody[0].expression.type === 'AssignmentExpression';

        if (hasVariable) {
            var variableArr = this.getVariables(astArr[0]);
            astArr.splice(0, 1);
            var contentArr = astArr.map(this.Node, this);

            result = variableArr.concat(contentArr);
        } else {
            result = astArr.map(this.Node, this);
        }

        return result.filter(function(t) {
            return t.length > 0;
        });
    };

    p.Program = function(component) {
        var thread = component.body.map(function(n) {
            var result = this.Node(n);
            this.assert(
                typeof result === 'object',
                '',
                n,
                'NO_SUPPORT',
                'GENERAL'
            );
            return result;
        }, this);

        if (thread[0].constructor == Array) return thread[0];
        else return thread;
    };

    p.ExpressionStatement = function(component) {
        return this.Node(component.expression);
    };

    p.CallExpression = function(component) {
        var callee = component.callee;
        var args = component.arguments;
        var params = [];
        var obj = this.Node(callee);
        if (obj.type && component.callee.type === 'Identifier')
            // Duplicate name with variable
            obj = callee.name;

        if (
            typeof obj === 'string' &&
            callee.type === 'MemberExpression' &&
            this[obj]
        )
            return this[obj](component);

        if (callee.type === 'Identifier') {
            // global function
            if (this._funcMap[obj]) {
                var funcType = this._funcMap[obj][args.length];
                obj = {
                    type: 'func_' + funcType,
                };
            } else if (this[obj]) {
                // special block like len
                return this[obj](component);
            } else {
                var blockInfo = this.blockSyntax[obj];
                this.assert(
                    blockInfo && blockInfo.key,
                    '',
                    callee,
                    'NO_FUNCTION',
                    'GENERAL'
                );
                obj = this.Block({}, blockInfo);
            }
        }

        if (obj.preParams) {
            component.arguments = obj.preParams.concat(component.arguments);
            delete obj.preParams;
        }

        if (component.arguments) {
            obj.params = this.Arguments(
                obj.type,
                component.arguments,
                obj.params
            );
        }

        if (obj.type == 'is_press_some_key') {
            obj.params = [
                Entry.KeyboardCode.map[component.arguments[0].value] + '',
            ];
        }

        return obj;
    };

    p.Identifier = function(component) {
        var name = component.name;

        if (this._isInFuncDef && this._funcParamMap[name])
            return {
                type: 'stringParam_' + this._funcParamMap[name],
            };

        var variable = Entry.variableContainer.getVariableByName(name);
        if (variable)
            return {
                type: 'get_variable',
                params: [variable.id_],
            };

        var list = Entry.variableContainer.getListByName(name);
        if (list)
            return {
                type: 'get_list',
                params: [list.id_],
            };
        return name;
    };

    p.VariableDeclaration = function(component) {
        var results = component.declarations.map(this.Node, this);

        return results;
    };

    p.VariableDeclarator = function(component) {
        if (component.init && component.init.arguments) {
            return component.init.arguments.map(this.Node, this);
        } else {
            return [];
        }
    };

    p.AssignmentExpression = function(component) {
        var lefts = Array.isArray(component.left)
            ? component.left
            : [component.left];
        var results = [];

        for (var i in lefts) {
            var result = { params: [] };
            var left = lefts[i];
            var leftVar;
            switch (left.type) {
                case 'MemberExpression':
                    result.type = 'change_value_list_index';
                    var leftName = left.object.name;
                    if (leftName === 'self') {
                        result.type = 'set_variable';
                        leftVar = Entry.variableContainer.getVariableByName(
                            left.property.name,
                            true,
                            this.object.id
                        );
                        if (!leftVar) {
                            Entry.variableContainer.addVariable({
                                variableType: 'variable',
                                name: left.property.name,
                                visible: true,
                                object: this.object.id,
                                value: 0,
                            });

                            leftVar = Entry.variableContainer.getVariableByName(
                                left.property.name,
                                true,
                                this.object.id
                            );
                        }

                        result.params.push(leftVar.id_);
                    } else {
                        leftVar = Entry.variableContainer.getListByName(
                            leftName
                        );
                        this.assert(
                            leftVar,
                            leftName,
                            left.object,
                            'NO_LIST',
                            'LIST'
                        );
                        result.params.push(leftVar.id_);
                        result.params.push(
                            this.ListIndex(
                                this.Node(left.property.arguments[1])
                            )
                        );
                    }
                    break;
                case 'Identifier':
                    result.type = 'set_variable';
                    leftVar = Entry.variableContainer.getVariableByName(
                        left.name,
                        false
                    );
                    if (!leftVar) {
                        Entry.variableContainer.addVariable({
                            variableType: 'variable',
                            name: left.name,
                            visible: true,
                            value: 0,
                        });
                        leftVar = Entry.variableContainer.getVariableByName(
                            left.name,
                            false
                        );
                    }
                    result.params.push(leftVar.id_);
                    break;
                default:
                    this.assert(false, 'error', left, 'NO_SUPPORT', 'GENERAL');
            }

            var rightHand = this.Node(component.right);

            switch (component.operator) {
                case '=':
                    break;
                case '+=':
                    if (result.type === 'set_variable') {
                        result.type = 'change_variable';
                        break;
                    }
                case '-=':
                case '/=':
                case '*=':
                default:
                    var operator = this.arithmeticOperator[
                        component.operator[0]
                    ];
                    if (operator) {
                        var getBlock;
                        if (result.type === 'set_variable')
                            getBlock = {
                                type: 'get_variable',
                                params: [leftVar.id_],
                            };
                        else
                            getBlock = {
                                type: 'value_of_index_from_list',
                                params: [
                                    undefined,
                                    leftVar.id_,
                                    undefined,
                                    this.ListIndex(
                                        this.Node(
                                            component.left.property.arguments[1]
                                        )
                                    ), // do not change this
                                ],
                            };
                        rightHand = {
                            type: 'calc_basic',
                            params: [getBlock, operator, rightHand],
                        };
                    }
            }
            result.params.push(rightHand);
            results.push(result);
        }

        return results;
    };

    p.Literal = function(component, paramSchema, paramDef) {
        var value = component.value;
        switch (typeof value) {
            case 'boolean':
                return { type: value ? 'True' : 'False' };
            default:
        }
        var paramType = paramSchema ? paramSchema.type : 'Block';
        switch (paramType) {
            case 'DropdownDynamic':
                return this.DropdownDynamic(value, paramSchema);
            case 'Block':
                if (paramDef && paramDef.type) {
                    // process primitive block
                    return {
                        type: paramDef.type,
                        params: this.Arguments(paramDef.type, [component]),
                    };
                }
                return {
                    type: 'number',
                    params: [this.getValue(component)],
                };
            default:
                return this.getValue(component);
        }
    };

    p.MemberExpression = function(component) {
        var obj;
        var result = {};
        if (component.object.name === 'self') {
            // local variable
            var localVar = Entry.variableContainer.getVariableByName(
                component.property.name,
                true,
                this.object.id
            );
            if (localVar)
                return {
                    type: 'get_variable',
                    params: [localVar.id_],
                };
            localVar = Entry.variableContainer.getListByName(
                component.property.name,
                true,
                this.object.id
            );
            if (localVar)
                return {
                    type: 'get_list',
                    params: [localVar.id_],
                };
            this.assert(localVar, 'variable not exist', component);
        } else if (component.object.type === 'Literal') {
            // string member
            obj = '%2';
            result.preParams = [component.object];
        } else {
            obj = this.Node(component.object);
        }

        if (typeof obj === 'object') {
            // list member
            if (obj.type === 'get_list') result.preParams = [obj.params[0]];
            else result.preParams = [component.object];
            obj = '%2';
        }
        var property = component.property;
        var blockInfo;

        if (property.type === 'CallExpression') {
            return this.SubscriptIndex(component);
        } else if (property.name === '_pySlice') {
            blockInfo = this.blockSyntax['%2[%4:%6]'];
        } else {
            var rawSyntax = obj + '.' + property.name;
            if (this.blockSyntax[obj] && this.blockSyntax[obj][property.name]) {
                if (this[rawSyntax]) return rawSyntax;
                blockInfo = this.blockSyntax[obj][property.name];
            } else return rawSyntax; // block syntax not exist. pass to special
        }

        this.Block(result, blockInfo);

        return result;
    };

    p.WhileStatement = function(component) {
        var blocks = component.body.body;
        var obj = {
            statements: [this.setParams(blocks)],
        };
        var test = component.test;
        if (test.raw === 'True') {
            obj.type = 'repeat_inf';
        } else {
            obj.type = 'repeat_while_true';
            if (test.type === 'UnaryExpression' && test.operator === '!') {
                obj.params = [this.Node(component.test.argument), 'until'];
            } else {
                obj.params = [this.Node(component.test), 'while'];
            }
        }

        return obj;
    };

    p.BlockStatement = function(component) {
        var db = component.body.map(this.Node, this);

        if (db.constructor == Array && db[0].length) {
            if (db.length > 0) db[db.length - 1][0].params.push(db[0][0][0]);

            db = db[db.length - 1][0];
        }

        return db;
    };

    p.IfStatement = function(component) {
        var arr = [],
            alternate,
            blocks,
            pararms;

        var tempAlt = component.alternate;
        var isForState =
            tempAlt &&
            tempAlt.body &&
            tempAlt.body[0] &&
            'type' in tempAlt.body[0] &&
            tempAlt.body[0].type === 'ForInStatement';

        var consequent = component.consequent;

        if (isForState) {
            alternate = component.alternate.body.map(this.Node, this);
            component.consequent.body[0].body.body.shift();

            blocks = component.consequent.body[0].body.body;
            alternate[0].statements.push(this.setParams(blocks));
        } else if (!('alternate' in component) || !component.alternate) {
            alternate = {
                type: '_if',
                statements: [this.setParams(component.consequent.body)],
                params: [this.Node(component.test)],
            };
        } else {
            var consequents = component.consequent
                ? component.consequent.body
                      .map(this.Node, this)
                      .map(function(b) {
                          return Array.isArray(b) ? b[0] : b;
                      })
                : [];
            var alternates = component.alternate
                ? component.alternate.body
                      .map(this.Node, this)
                      .map(function(b) {
                          return Array.isArray(b) ? b[0] : b;
                      })
                : [];
            alternate = {
                type: 'if_else',
                statements: [consequents, alternates],
                params: [this.Node(component.test)],
            };
        }

        return alternate;
    };

    p.ForStatement = function(component) {
        var body = component.body.body;
        return this.Node(body[body.length - 1]);
    };

    p.ForInStatement = function(component) {
        // var  expression = component.body.body[0] && 'expression' in component.body.body[0] ?
        //                     this.Node(component.body.body[0].expression) : null;
        var obj = {
            type: 'repeat_basic',
            params: [],
            statements: [],
        };

        return obj;
    };

    p.BreakStatement = function(component) {
        return {
            type: this.blockSyntax.break.key,
        };
    };

    p.UnaryExpression = function(component) {
        switch (component.operator) {
            case '!':
                return {
                    type: 'boolean_not',
                    params: [undefined, this.Node(component.argument)],
                };
            case '-':
            case '+':
                var result = this.Node(component.argument);
                if (result.type === 'number') {
                    result.params = [component.operator + result.params[0]];
                    return result;
                } else {
                    return {
                        type: 'calc_basic',
                        params: [
                            {
                                type: 'number',
                                params: [component.operator + '1'],
                            },
                            'MULTI',
                            result,
                        ],
                    };
                }
            default:
                throw new Error(
                    'Unary operator ' + component.operator + ' is not supported'
                );
        }
    };

    p.LogicalExpression = function(component) {
        return {
            type: 'boolean_and_or',
            params: [
                this.Node(component.left),
                this.logicalOperator[component.operator],
                this.Node(component.right),
            ],
        };
    };

    p.BinaryExpression = function(component) {
        var operator = component.operator,
            blockType;
        if (this.binaryOperator[operator]) {
            blockType = 'boolean_basic_operator';
            operator = this.binaryOperator[operator];
        } else if (this.arithmeticOperator[operator]) {
            blockType = 'calc_basic';
            operator = this.arithmeticOperator[operator];
        } else if (this.divideOperator[operator]) {
            return {
                type: 'quotient_and_mod',
                params: [
                    undefined,
                    this.Node(component.left),
                    undefined,
                    this.Node(component.right),
                    undefined,
                    this.divideOperator[operator],
                ],
            };
        } else if (operator === '**') {
            this.assert(
                component.right.value === 2,
                component.right.value,
                component,
                'DEFAULT',
                'DEFAULT'
            );
            return {
                type: 'calc_operation',
                params: [
                    undefined,
                    this.Node(component.left),
                    undefined,
                    'square',
                ],
            };
        } else {
            throw new Error('Not supported operator ' + component.operator);
        }
        return {
            type: blockType,
            params: [
                this.Node(component.left),
                operator,
                this.Node(component.right),
            ],
        };
    };

    // p.UpdateExpression = function(component) {};

    p.FunctionDeclaration = function(component) {
        var funcName = component.id.name;
        this.assert(
            !this._isInFuncDef,
            funcName,
            component,
            'NO_ENTRY_EVENT_FUNCTION',
            'FUNCTION'
        );
        this._isInFuncDef = true;
        var startBlock = {};
        this.assert(
            component.body.body[0],
            funcName,
            component,
            'NO_OBJECT',
            'OBJECT'
        );
        var blocks = component.body.body[0].argument.callee.object.body.body;

        if (funcName === 'when_press_key')
            if (!component.arguments || !component.arguments[0]) {
                startBlock.params = [null, null];
            } else {
                var name = component.arguments[0].name;
                startBlock.params = [null, Entry.KeyboardCode.map[name] + ''];
            }

        if (funcName === 'when_get_signal') {
            if (!component.arguments || !component.arguments[0]) {
                startBlock.params = [null, null];
            } else {
                var name = component.arguments[0].name;
                startBlock.params = [null, this.getMessage(name)];
            }
        }

        var blockInfo = this.blockSyntax['def ' + funcName];
        var threadArr;
        if (blockInfo) {
            // event block
            startBlock.type = blockInfo.key;
            var definedBlocks = this.setParams(blocks);

            threadArr = [startBlock];
            definedBlocks.unshift(startBlock);
            this._isInFuncDef = false;
            return definedBlocks;
        } else {
            this.createFunction(component, funcName, blocks);
            this._isInFuncDef = false;
            return [];
        }
    };

    p.FunctionExpression = function(component) {
        var a = this.Node(component.body);
        return a;
    };

    p.ReturnStatement = function(component) {
        return component.argument.arguments.map(this.Node, this);
    };

    // p.ThisExpression = function(component) {};

    p.NewExpression = function(component) {
        var callee = component.callee;
        var args = component.arguments;

        return this.Node(callee);
    };

    p.SubscriptIndex = function(component) {
        var obj = this.Node(component.object);
        var blockInfo;

        if (obj.type === 'get_list') {
            // string
            blockInfo = this.blockSyntax['%2[%4]'];
        } else {
            // var, list
            blockInfo = this.blockSyntax['%2[%4]#char_at'];
        }
        var result = this.Block({}, blockInfo);
        result.params = this.Arguments(
            result.type,
            component.property.arguments
        );
        return result;
    };

    /**
     * util Function
     */

    p.Arguments = function(blockType, args, defaultParams) {
        var defParams, sortedArgs, blockSchema;
        blockSchema = Entry.block[blockType];
        if ((blockType && blockType.substr(0, 5) === 'func_') || !blockSchema) {
            // function block, etc
            sortedArgs = args;
        } else {
            var syntax = this.PySyntax(blockSchema, defaultParams);
            var indexes = syntax.match(/%\d+/g, '');
            if (!indexes) return defaultParams || [];
            sortedArgs = defaultParams || new Array();

            for (var i = 0; i < indexes.length; i++) {
                var idx = parseInt(indexes[i].substring(1)) - 1;
                sortedArgs[idx] = args[i];
            }
            defParams =
                blockSchema.def && blockSchema.def.params
                    ? blockSchema.def.params
                    : undefined;
        }
        var results = sortedArgs.map(function(arg, index) {
            if (arg && arg.type) {
                var paramSchema = blockSchema
                    ? blockSchema.params[index]
                    : null;
                var param = this.Node(
                    arg,
                    arg.type === 'Literal' ? paramSchema : undefined,
                    arg.type === 'Literal' && defParams
                        ? defParams[index]
                        : undefined
                );

                this.assert(
                    !(typeof param === 'string' && arg.type === 'Identifier'),
                    param,
                    arg,
                    'NO_VARIABLE',
                    'VARIABLE'
                );

                if (!paramSchema) param = param;
                else if (paramSchema.type !== 'Block' && param && param.params)
                    // for list and variable dropdown
                    param = param.params[0];
                else if (
                    paramSchema.type === 'Block' &&
                    paramSchema.isListIndex
                )
                    param = this.ListIndex(param);

                return param;
            } else return arg; // default params
        }, this);

        var codeMap = this.CodeMap(blockType);
        if (codeMap) {
            results = results.map(function(arg, index) {
                if (codeMap[index] && arg) {
                    return codeMap[index][this.toLowerCase(arg)] || arg;
                } else {
                    return arg;
                }
            }, this);
        }

        return results;
    };

    p.getValue = function(component) {
        var value;
        if (component.type === 'Literal') {
            value = component.raw;

            if (value === 'None') {
                return;
            } else if (!component.value) {
                value = 0;
            } else if (component.value.constructor === String) {
                if (component.raw.includes('"') || component.raw.includes("'"))
                    value = component.raw.substr(1, component.raw.length - 2);
                else value = component.raw;
            } else if (component.value.constructor === Number) {
                value = component.value;
            }

            return value;
        } else {
            value = this.Node(component);
            return value.params && value.params[0] ? value.params[0] : null;
        }
    };

    p.getMessage = function(name) {
        if (!name) return;
        name = name.replace(/_space_/gi, ' ');

        var objects = Entry.variableContainer.messages_.filter(function(obj) {
            return obj.name === name;
        });

        if (objects.length <= 0) {
            Entry.variableContainer.addMessage({
                name: name,
            });
            objects = Entry.variableContainer.messages_.filter(function(obj) {
                return obj.name === name;
            });
        }

        var object;
        if (objects && objects.length > 0) object = objects[0].id;
        else {
            object = name;
        }

        return object;
    };

    p.DropdownDynamic = function(value, paramSchema) {
        switch (paramSchema.menuName) {
            case 'sprites':

            case 'spritesWithMouse':
                var object;

                var objects = Entry.container.objects_.filter(function(obj) {
                    return obj.name === value;
                });

                if (objects && objects.length > 0) object = objects[0].id;
                else {
                    object = value;
                }

                return object;

                break;
            case 'spritesWithSelf':
                var object;

                if (!value) {
                    object = 'None';
                } else if (value == 'self') {
                    object = value;
                } else {
                    var objects = Entry.container.objects_.filter(function(
                        obj
                    ) {
                        return obj.name === value;
                    });

                    object = objects[0].id;
                }

                return object;
                break;
            case 'collision':
                var object;

                var objects = Entry.container.objects_.filter(function(obj) {
                    return obj.name === value;
                });

                if (objects && objects.length > 0) object = objects[0].id;
                else {
                    object = value;
                }

                return object;

                break;
            case 'pictures':
                var picture = this.object.getPicture(value);
                return picture ? picture.id : undefined;
            case 'messages':
                return this.getMessage(value);
                break;
            case 'variables':
                if (!value) return;
                value = value.split('.');
                var variable;
                if (value.length > 1)
                    // self variable
                    variable = Entry.variableContainer.getVariableByName(
                        value[1],
                        true,
                        this.object.id
                    );
                else
                    variable = Entry.variableContainer.getVariableByName(
                        value[0],
                        false,
                        this.object.id
                    );
                return variable ? variable.id_ : undefined;
            case 'lists':
                if (!value) return;
                value = value.split('.');
                var list;
                if (value.length > 1)
                    // self variable
                    list = Entry.variableContainer.getListByName(
                        value[1],
                        true,
                        this.object.id
                    );
                else
                    list = Entry.variableContainer.getListByName(
                        value[0],
                        false,
                        this.object.id
                    );
                return list ? list.id_ : undefined;
            case 'scenes':
                var scenes = Entry.scene.scenes_.filter(function(s) {
                    return s.name === value;
                });
                return scenes[0] ? scenes[0].id : undefined;
            case 'sounds':
                if (value) var sound = this.object.getSound(value);
                return sound ? sound.id : undefined;
            case 'clone':
            case 'textBoxWithSelf':
                var object;

                if (!value) {
                    object = null;
                } else if (value == 'self') {
                    object = value;
                } else {
                    var objects = Entry.container.objects_.filter(function(
                        obj
                    ) {
                        return obj.name === value;
                    });

                    object = objects[0] ? objects[0].id : null;
                }

                return object;
            case 'objectSequence':
        }
    };

    p.Node = function(nodeType, node) {
        var hasType = false;
        if (typeof nodeType === 'string' && nodeType !== node.type)
            this.assert(
                false,
                node.name || node.value || node.operator,
                node,
                'NO_SUPPORT',
                'GENERAL'
            );
        else if (typeof nodeType === 'string') hasType = true;

        var args = Array.prototype.slice.call(arguments);
        if (hasType) args.shift();

        node = args[0];

        if (!this[node.type]) throw new Error(node.type + ' is not supported');
        return this[node.type].apply(this, args);
    };

    p.PySyntax = function(blockSchema, defaultParams) {
        if (defaultParams) {
            var syntaxes = blockSchema.syntax.py.filter(function(s) {
                if (!s.params) return false;
                var isSame = true;
                s.params.map(function(p, index) {
                    if (p != defaultParams[index]) isSame = false;
                });
                return isSame;
            });
            if (syntaxes.length) return syntaxes[0].syntax;
        }
        var syntaxObj = blockSchema.syntax.py[0];
        return syntaxObj.syntax || syntaxObj;
    };

    p.CodeMap = function(blockType) {
        for (var objName in Entry.CodeMap) {
            if (Entry.CodeMap[objName] && Entry.CodeMap[objName][blockType])
                return Entry.CodeMap[objName][blockType];
        }
    };

    p.Block = function(result, blockInfo) {
        result.type = blockInfo.key;

        if (blockInfo.params) result.params = blockInfo.params.concat();
        return result;
    };

    p.ListIndex = function(param) {
        if (this.isParamPrimitive(param)) {
            // literal
            param.params = [Number(param.params[0]) + 1];
        } else if (
            param.type === 'calc_basic' && // x - 1
            param.params[1] === 'MINUS' &&
            this.isParamPrimitive(param.params[2]) &&
            param.params[2].params[0] + '' === '1'
        ) {
            param = param.params[0];
        } else {
            param = {
                type: 'calc_basic',
                params: [
                    param,
                    'PLUS',
                    {
                        type: 'text',
                        params: ['1'],
                    },
                ],
            };
        }
        return param;
    };

    p.isParamPrimitive = function(param) {
        return param && (param.type === 'number' || param.type === 'text');
    };

    p.assert = function(data, keyword, errorNode, message, subject) {
        if (data) return;
        Entry.TextCodingError.error(
            Entry.TextCodingError.TITLE_CONVERTING,
            Entry.TextCodingError['MESSAGE_CONV_' + (message || 'NO_SUPPORT')],
            keyword,
            errorNode.loc,
            Entry.TextCodingError['SUBJECT_CONV_' + (subject || 'GENERAL')]
        );
    };

    p.setParams = function(params) {
        var definedBlocks = params.length
            ? params.map(function(n) {
                  var result = this.Node(n);
                  this.assert(
                      typeof result === 'object',
                      '',
                      n,
                      'NO_SUPPORT',
                      'GENERAL'
                  );
                  return result;
              }, this)
            : [];

        var results = [];
        for (var i = 0; i < definedBlocks.length; i++) {
            var db = definedBlocks[i];

            if (Array.isArray(db)) results = results.concat(db);
            else results.push(db);
        }

        return results.filter(function(b) {
            return b.constructor === Object;
        });
    };

    p.getVariables = function(program) {
        var nodes = program.body;

        nodes.map(function(n) {
            n = n.expression;
            var left = n.left;
            var right = n.right;
            var name;
            var type = 'variables_';
            var id = Entry.generateHash();
            var value, array;

            if (n.operator != '=') return;

            if (
                right.type === 'NewExpression' &&
                right.callee.property.name == 'list'
            ) {
                type = 'lists_';
                var temp = right.arguments.map(this.Node, this);

                temp = temp.map(function(m) {
                    if (m.constructor === Object && 'params' in m) {
                        return {
                            data:
                                typeof m.params[0] === 'string'
                                    ? m.params[0].replace(/\\\"/gi, '"')
                                    : m.params[0],
                        };
                    } else {
                        return { data: m };
                    }
                });

                array = temp;
            } else {
                value = this.getValue(right);
            }

            var functionType =
                'add' + type[0].toUpperCase() + type.slice(1, type.length - 2);

            if (!Array.isArray(left)) left = [left];

            for (var key in left) {
                var object = false;
                var l = left[key];

                var obj = {
                    variableType: 'variable',
                    name: '',
                    visible: true,
                    object: {},
                    value: '',
                };
                if (array) obj.array = array;
                if (value) obj.value = value;

                if ('name' in l) {
                    name = l.name;
                } else {
                    object = this.object;
                    name = l.property.name;
                    object = object.id;
                }

                var existVar = this.variableExist(name, type);

                if (existVar) {
                    if (type == 'lists_') {
                        existVar.array_ = obj.array;
                        return;
                    }
                    existVar.value_ = this.getValue(right);
                    return;
                } else {
                    obj.variableType = type.slice(0, length - 2);
                    obj.name = name;
                    obj.object = object;
                    Entry.variableContainer[functionType](obj);
                }
            }
        }, this);

        return [];
    };

    p.variableExist = function(name, type) {
        var variables_ = Entry.variableContainer[type];
        variables_ = variables_.map(function(v) {
            return v.name_;
        });

        if (variables_.indexOf(name) > -1)
            return Entry.variableContainer[type][variables_.indexOf(name)];
        return false;
    };

    /**
     * Special Blocks
     */

    p.len = function(component) {
        var param = this.Node(component.arguments[0]);
        this.assert(
            !(
                typeof param === 'string' &&
                component.arguments[0].type === 'Identifier'
            ),
            param,
            component.arguments[0],
            'NO_VARIABLE',
            'VARIABLE'
        );

        if (param.type === 'get_list') {
            // string len
            return {
                type: 'length_of_list',
                params: [undefined, param.params[0]],
            };
        } else {
            // array len
            return {
                type: 'length_of_string',
                params: [undefined, param],
            };
        }
    };

    p['Hamster.note'] = function(component) {
        var blockInfo;
        if (component.arguments.length > 2) {
            blockInfo = this.blockSyntax.Hamster.note;
        } else {
            blockInfo = this.blockSyntax.Hamster['note#0'];
            component.arguments.shift();
        }
        var obj = this.Block({}, blockInfo);
        obj.params = this.Arguments(blockInfo.key, component.arguments);
        if (component.arguments.length > 2) {
            obj.params[0] =
                Entry.CodeMap.Hamster.hamster_play_note_for[0][
                    this.toLowerCase(obj.params[0])
                ];
        }
        return obj;
    };

    p['Hamster.line_tracer_mode'] = function(component) {
        return this.Special(component, 'Hamster', 'line_tracer_mode');
    };

    p['Hamster.io_mode_a'] = function(component) {
        return this.Special(component, 'Hamster', 'io_mode_a');
    };

    p['Hamster.io_mode_b'] = function(component) {
        return this.Special(component, 'Hamster', 'io_mode_b');
    };

    p['Hamster.io_modes'] = function(component) {
        return this.Special(component, 'Hamster', 'io_modes');
    };

    p['Hamster.leds'] = function(component) {
        return this.Special(component, 'Hamster', 'leds');
    };

    p['Hamster.left_led'] = function(component) {
        return this.Special(component, 'Hamster', 'left_led');
    };

    p['Hamster.right_led'] = function(component) {
        return this.Special(component, 'Hamster', 'right_led');
    };

    p['__pythonRuntime.ops.in'] = function(component) {
        // "10 in list"
        return {
            type: 'is_included_in_list',
            params: this.Arguments('is_included_in_list', component.arguments),
        };
    };

    p.Special = function(component, name, key) {
        var result = {};
        var param = this.Node(component.arguments[0]);
        if (this.isParamPrimitive(param)) param = param.params[0];
        var blockInfo = this.blockSyntax[name][key + '(' + param + ')'];

        this.Block(result, blockInfo);
        return result;
    };

    p.createFunctionMap = function() {
        this._funcMap = {};
        var functions = Entry.variableContainer.functions_;
        for (var key in functions) {
            var funcSchema = Entry.block['func_' + key];
            var funcName = funcSchema.template
                .trim()
                .split(' ')[0]
                .trim();
            if (!this._funcMap[funcName]) this._funcMap[funcName] = {};
            this._funcMap[funcName][funcSchema.params.length - 1] = key;
        }
    };

    p.createFunction = function(component, funcName, blocks) {
        var params = component.arguments
            ? component.arguments.map(this.Node, this)
            : [];
        var functions = Entry.variableContainer.functions_;

        var funcId = Entry.generateHash();
        for (var key in functions) {
            var funcSchema = Entry.block['func_' + key];
            if (
                funcSchema.params.length === params.length + 1 &&
                funcSchema.template
                    .trim()
                    .split(' ')[0]
                    .trim() === funcName
            ) {
                funcId = key;
                break;
            }
        }

        var funcParamPointer = {
            type: 'function_field_label',
            params: [funcName],
        };
        var func = {
            id: funcId,
            content: [
                [
                    {
                        type: 'function_create',
                        params: [funcParamPointer],
                    },
                ],
            ],
        };

        if (!this._funcMap[funcName]) this._funcMap[funcName] = {};
        this._funcMap[funcName][params.length] = func.id;

        while (params.length) {
            // generate param
            var param = params.shift();
            var paramId = Entry.Func.requestParamBlock('string');
            var newFuncParam = {
                type: 'function_field_string',
                params: [
                    {
                        type: paramId,
                    },
                ],
            };
            paramId = paramId.split('_')[1];
            this._funcParamMap[param] = paramId;
            funcParamPointer.params.push(newFuncParam);
            funcParamPointer = newFuncParam;
        }

        var definedBlocks = this.setParams(blocks); // function content
        this._funcParamMap = {};

        func.content[0] = func.content[0].concat(definedBlocks);

        func.content = JSON.stringify(func.content);
        if (functions[funcId]) {
            var targetFunc = functions[funcId];
            targetFunc.content = new Entry.Code(func.content);
            targetFunc.generateBlock(true);
            Entry.Func.generateWsBlock(targetFunc);
        } else {
            Entry.variableContainer.setFunctions([func]);
        }
    };

    /**
     * Not Supported
     */

    p.ClassDeclaration = function(component) {
        var funcName = this.Node(component.id);
        this.assert(false, funcName, component, 'NO_OBJECT', 'OBJECT');
    };

    // p.RegExp = function(component) {};

    // p.Function = function(component) {};

    // p.EmptyStatement = function(component) {};

    // p.DebuggerStatement = function(component) {};

    // p.WithStatement = function(component) {};

    // p.LabeledStatement = function(component) {};

    // p.ContinueStatement = function(component) {};

    // p.SwitchStatement = function(component) {};

    // p.SwitchCase = function(component) {};

    // p.ThrowStatement = function(component) {};

    // p.TryStatement = function(component) {};

    // p.CatchClause = function(component) {};

    // p.DoWhileStatement = function(component) {
    //     return component.body.map(this.Node,  this);
    // };

    // p.ArrayExpression = function(component) {};

    // p.ObjectExpression = function(component) {};

    // p.Property = function(component) {};

    // p.ConditionalExpression = function(component) {};

    // p.SequenceExpression = function(component) {};

    p.searchSyntax = function(datum) {
        //legacy
        var schema;
        var appliedParams;
        var doNotCheckParams = false;

        if (datum instanceof Entry.BlockView) {
            schema = datum.block._schema;
            appliedParams = datum.block.data.params;
        } else if (datum instanceof Entry.Block) {
            schema = datum._schema;
            appliedParams = datum.params;
        } else {
            schema = datum;
            doNotCheckParams = true;
        }

        if (schema && schema.syntax) {
            var syntaxes = schema.syntax.py.concat();
            while (syntaxes.length) {
                var isFail = false;
                var syntax = syntaxes.shift();
                if (typeof syntax === 'string')
                    return { syntax: syntax, template: syntax };
                if (syntax.params) {
                    for (var i = 0; i < syntax.params.length; i++) {
                        if (
                            doNotCheckParams !== true &&
                            syntax.params[i] &&
                            syntax.params[i] !== appliedParams[i]
                        ) {
                            isFail = true;
                            break;
                        }
                    }
                }
                if (!syntax.template) syntax.template = syntax.syntax;
                if (isFail) {
                    continue;
                }
                return syntax;
            }
        }
        return null;
    };

    p.toLowerCase = function(data) {
        if (data && data.toLowerCase) return data.toLowerCase();
        else return data;
    };
})(Entry.PyToBlockParser.prototype);
