const express = require('express');
const morgan = require('morgan');
const flash = require('express-flash');
const session = require('express-session');
const { body, validationResult } = require('express-validator');
const store = require("connect-loki");

const TodoList = require("./lib/todolist");
const Todo = require("./lib/todo");
const { sortTodoLists, sortTodos } = require("./lib/sort");

const app = express();
const host = 'localhost';
const port = 3000;
const LokiStore = store(session);

app.set('views', './views');
app.set('view engine', 'pug');

app.use(morgan('common'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000, // 31 days in milliseconds
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: "this is not very secure",
  store: new LokiStore({}),
}));

app.use(flash());

//Set up persistent session data
app.use((req, res, next) => {
  let todoLists = [];

  if ("todoLists" in req.session) {
    req.session.todoLists.forEach(todoList => {
      todoLists.push(TodoList.makeTodoList(todoList));
    });
  }
  req.session.todoLists = todoLists;
  next();
});

//extract session info 
app.use((req, res, next) => {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

//Find todo list wtih indicated ID
//returns undefined if not found 
const loadTodoList = (todoListId, todoLists) => {
  return todoLists.find(todoList => todoList.id === todoListId);
}

//Finds a todo with correct id in indicated todo list
//returns undefined if list not found 
const loadTodo = (todoListId, todoId, todoLists) => {
  let todoList = loadTodoList(todoListId, todoLists);
  if (!todoList) return undefined;

  return todoList.todos.find(todo => todo.id === todoId);
}

//Handles GET requests to the root path and renders the lists.pug view
app.get('/', (req, res) => {
  res.redirect('/lists');
});

app.get('/lists', (req, res) => {
  res.render('lists', {
    todoLists: sortTodoLists(req.session.todoLists),
  });
});

app.get('/lists/new', (req, res) => {
  res.render('new-list');
});

app.post("/lists",
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
      .custom((title, { req }) => {
        let todoLists = req.session.todoLists;
        let duplicate = req.session.todoLists.find(list => list.title === title);
        return duplicate === undefined;
      })
      .withMessage("List title must be unique."),
  ],
  (req, res) => {
    let errors = validationResult(req);

    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      res.render("new-list", {
        flash: req.flash(),
        todoListTitle: req.body.todoListTitle,
      });
    } else {
      req.session.todoLists.push(new TodoList(req.body.todoListTitle));
      req.flash("success", "The todo list has been created.");
      res.redirect("/lists");
    }
  }
);

//Render individual todo list and its todos
app.get("/lists/:todoListId", (req, res, next) => {
  let todoListId = Number(req.params.todoListId);
  let todoList = loadTodoList(todoListId, req.session.todoLists);

  if (todoList === undefined) {
    next(new Error("not found."));

  } else {
    res.render("list", {
      todoList: todoList,
      todos: sortTodos(todoList),
    });
  }
});

//Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle", (req,res, next) => {
  let { todoListId, todoId } = { ...req.params };
  let todo = loadTodo(Number(todoListId), Number(todoId), req.session.todoLists);

  if(!todo) {
    next(new Error("Not found."));

  } else {
    let title = todo.title;

    if (todo.isDone()) {
      todo.markUndone();
      req.flash("success", `${title} marked as NOT done!`);

    } else {
      todo.markDone();
      req.flash("success", `${title} marked done.`);
    }

    res.redirect(`/lists/${todoListId}`);
  }
});

//Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy", (req, res, next) => {
  let { todoListId, todoId } = { ...req.params };
  let todoList = loadTodoList(Number(todoListId), req.session.todoLists);

  if (!todoList) {
    next(new Error("Not found."));

  } else {
    let todo = loadTodo(Number(todoListId), Number(todoId), req.session.todoLists);

    if (!todo) {
      next(new Error("Not found."));

    } else {
        let index = todoList.findIndexOf(todo);
        todoList.removeAt(index);
        req.flash("success", "The todo has been deleted.");
        res.redirect(`/lists/${todoListId}`);
    }
  }
});

//Mark all todos done
app.post("/lists/:todoListId/complete_all", (req, res, next) => {
  let todoListId = Number(req.params.todoListId);
  let todoList = loadTodoList(todoListId, req.session.todoLists);

  if (!todoList) {
    next(new Error("Not found."));

  } else {
    todoList.markAllDone();
    req.flash("success", "All todos have been marked done.");
    res.redirect(`/lists/${todoListId}`);
  }
});

//Create new todo and add to the right list
app.post("/lists/:todoListId/todos", 
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters"),
  ],

  (req, res, next) => {
    let todoListId = Number(req.params.todoListId);
    let todoList = loadTodoList(todoListId, req.session.todoLists);
    
    if (!todoList) {
      next(new Error("Not found."));

    } else {
        let errors = validationResult(req);

        if (!errors.isEmpty()) {
          errors.array().forEach(message => req.flash("error", message.msg));

          res.render("list", {
            flash: req.flash(),
            todoList: todoList,
            todos: sortTodos(todoList),
            todoTitle: req.body.todoTitle,
          });
      } else {
        let todo = new Todo(req.body.todoTitle);
        todoList.add(todo);
        req.flash("success", "Todo added!");
        res.redirect(`/lists/${todoListId}`);
      }
    }
  }
);

//Render edit todo list form 
app.get("/lists/:todoListId/edit", (req, res, next) => {
  let todoListId = Number(req.params.todoListId);
  let todoList = loadTodoList(todoListId, req.session.todoLists);

  if (!todoList) {
    next(new Error("Not found."));

  } else {
      res.render("edit-list", { todoList });
  }
});

//Edit todo list title
app.post("/lists/:todoListId/edit", 
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters")
      .custom((title, { req } ) => {
        let todoLists = req.session.todoLists;
        let duplicate = todoLists.find(list => list.title === title);
        return duplicate === undefined;
      })
      .withMessage("List title must be unique"),
  ],

  (req, res, next) => {
    let todoListId = Number(req.params.todoListId);
    let todoList = loadTodoList(todoListId, req.session.todoLists);
    
    if (!todoList) {
      next(new Error("Not found."));
 
    } else {
        let errors = validationResult(req);

        if (!errors.isEmpty()) {
          errors.array().forEach(message => req.flash("error", message.msg));

          res.render("edit-list", {
            flash: req.flash(),
            todoListTitle: req.body.todoListTitle,
            todoList: todoList,
          });
      } else {
        todoList.setTitle(req.body.todoListTitle);  
        req.flash("success", "Todo list updated.");
        res.redirect(`/lists/${todoListId}`);
      }
    }
  }
);

//Delete todo list
app.post("/lists/:todoListId/destroy", (req, res, next) => {
  let todoLists = req.session.todoLists;
  let todoListId = Number(req.params.todoListId);
  let index = todoLists.findIndex(todoList => todoList.id === todoListId);

  if (!index === -1) {
    next(new Error("Not found."));

  } else {
    req.session.todoLists.splice(index, 1);
    req.flash("success", "Todo List deleted!");
    res.redirect("/lists");
  }
});

//Error handler
app.use((err, req, res, _next) => {
  console.log(err);
  res.status(404).send(err.message);
});

//Listener
app.listen(port, host, () => {
  console.log(`Todos listening on port ${port} of ${host}...`);
});