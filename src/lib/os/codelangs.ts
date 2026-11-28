// REDSEC v5.0 — Task 26: OpenCode language catalog (single source of truth).
// The OS builds with ALL source packs pre-installed; the App Store can uninstall
// (codeLangsRemoved) and OpenCode re-installs on demand.
// (Task 66 — the store type import went away with codeLangsRemoved; plain string[] now)

export type CodeRunner = 'js' | 'ts' | 'preview' | 'pyodide' | 'sim'

export interface CodeLang {
  id: string
  name: string
  category: 'Core' | 'Web & Frontend' | 'Backend' | 'Databases' | 'Hardware'
  ext: string // file extension used when saving
  runner: CodeRunner
  hl: 'js' | 'py' | 'c' | 'java' | 'ruby' | 'lisp' | 'sql' | 'html' | 'css' | 'asm' | 'hdl' | 'r' | 'dart' | 'rust' // highlight family
  banner: string // the toolchain line shown when building/running
  pkg: string // package name shown in the App Store
  sample: string
}

const L = (l: CodeLang) => l

export const CODE_LANGS: CodeLang[] = [
  /* ---------------- Core programming languages ---------------- */
  L({ id: 'python', name: 'Python', category: 'Core', ext: 'py', runner: 'pyodide', hl: 'py', banner: '$ python3 main.py', pkg: 'python3-defaults', sample: '# Python\ndef main():\n    print("Hello, OpenCode!")\n    for i in range(1, 4):\n        print(f"count {i}")\n\nif __name__ == "__main__":\n    main()\n' }),
  L({ id: 'java', name: 'Java', category: 'Core', ext: 'java', runner: 'sim', hl: 'java', banner: '$ javac Main.java && java Main', pkg: 'openjdk-21-jdk', sample: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, OpenCode!");\n    }\n}\n' }),
  L({ id: 'c', name: 'C', category: 'Core', ext: 'c', runner: 'sim', hl: 'c', banner: '$ gcc main.c -o main -O2 && ./main', pkg: 'build-essential', sample: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, OpenCode!\\n");\n    return 0;\n}\n' }),
  L({ id: 'cpp', name: 'C++', category: 'Core', ext: 'cpp', runner: 'sim', hl: 'c', banner: '$ g++ main.cpp -std=c++20 -O2 && ./a.out', pkg: 'g++-13', sample: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, OpenCode!" << std::endl;\n    return 0;\n}\n' }),
  L({ id: 'csharp', name: 'C#', category: 'Core', ext: 'cs', runner: 'sim', hl: 'java', banner: '$ dotnet build -c Release && dotnet run', pkg: 'dotnet-sdk-9.0', sample: 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, OpenCode!");\n    }\n}\n' }),
  L({ id: 'go', name: 'Go', category: 'Core', ext: 'go', runner: 'sim', hl: 'js', banner: '$ go build -o main main.go && ./main', pkg: 'golang-1.23', sample: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, OpenCode!")\n}\n' }),
  L({ id: 'rust', name: 'Rust', category: 'Core', ext: 'rs', runner: 'sim', hl: 'rust', banner: '$ rustc -O main.rs && ./main', pkg: 'rustc cargo', sample: 'fn main() {\n    println!("Hello, OpenCode!");\n}\n' }),
  L({ id: 'ruby', name: 'Ruby', category: 'Core', ext: 'rb', runner: 'sim', hl: 'ruby', banner: '$ ruby main.rb', pkg: 'ruby-full', sample: '# Ruby\n3.times do |i|\n  puts "Hello, OpenCode! (#{i})"\nend\n' }),
  L({ id: 'kotlin', name: 'Kotlin', category: 'Core', ext: 'kt', runner: 'sim', hl: 'java', banner: '$ kotlinc main.kt -include-runtime -d main.jar && java -jar main.jar', pkg: 'kotlin', sample: 'fun main() {\n    println("Hello, OpenCode!")\n}\n' }),
  L({ id: 'swift', name: 'Swift', category: 'Core', ext: 'swift', runner: 'sim', hl: 'js', banner: '$ swiftc -O main.swift && ./main', pkg: 'swiftlang', sample: 'import Foundation\n\nprint("Hello, OpenCode!")\n' }),
  L({ id: 'scala', name: 'Scala', category: 'Core', ext: 'scala', runner: 'sim', hl: 'java', banner: '$ scalac main.scala && scala Main', pkg: 'scala', sample: 'object Main extends App {\n  println("Hello, OpenCode!")\n}\n' }),
  L({ id: 'dart', name: 'Dart', category: 'Core', ext: 'dart', runner: 'sim', hl: 'js', banner: '$ dart run main.dart', pkg: 'dart-sdk', sample: 'void main() {\n  print(\'Hello, OpenCode!\');\n}\n' }),
  L({ id: 'typescript', name: 'TypeScript', category: 'Core', ext: 'ts', runner: 'ts', hl: 'js', banner: '$ tsc main.ts && node main.js', pkg: 'typescript', sample: 'const greet = (name: string): string => {\n  return `Hello, ${name}!`;\n};\n\nconsole.log(greet("OpenCode"));\n' }),
  L({ id: 'lua', name: 'Lua', category: 'Core', ext: 'lua', runner: 'sim', hl: 'js', banner: '$ lua5.4 main.lua', pkg: 'lua5.4', sample: '-- Lua\nfor i = 1, 3 do\n  print("Hello, OpenCode! " .. i)\nend\n' }),
  L({ id: 'perl', name: 'Perl', category: 'Core', ext: 'pl', runner: 'sim', hl: 'ruby', banner: '$ perl main.pl', pkg: 'perl', sample: '# Perl\nforeach my $i (1..3) {\n  print "Hello, OpenCode! ($i)\\n";\n}\n' }),
  L({ id: 'r', name: 'R', category: 'Core', ext: 'R', runner: 'sim', hl: 'r', banner: '$ Rscript main.R', pkg: 'r-base', sample: '# R\ncat("Hello, OpenCode!\\n")\nfor (i in 1:3) {\n  cat("count", i, "\\n")\n}\n' }),
  L({ id: 'haskell', name: 'Haskell', category: 'Core', ext: 'hs', runner: 'sim', hl: 'lisp', banner: '$ ghc -O2 main.hs && ./main', pkg: 'ghc', sample: 'main :: IO ()\nmain = do\n  putStrLn "Hello, OpenCode!"\n  mapM_ (\\i -> putStrLn ("count " ++ show i)) [1..3]\n' }),
  L({ id: 'erlang', name: 'Erlang', category: 'Core', ext: 'erl', runner: 'sim', hl: 'lisp', banner: '$ erlc main.erl && escript main.beam', pkg: 'erlang', sample: '-module(main).\n-export([main/0]).\n\nmain() ->\n    io:format("Hello, OpenCode!~n").\n' }),
  L({ id: 'elixir', name: 'Elixir', category: 'Core', ext: 'ex', runner: 'sim', hl: 'ruby', banner: '$ elixir main.exs', pkg: 'elixir', sample: '# Elixir\nEnum.each(1..3, fn i ->\n  IO.puts "Hello, OpenCode! #{i}"\nend)\n' }),
  L({ id: 'fortran', name: 'Fortran', category: 'Core', ext: 'f90', runner: 'sim', hl: 'r', banner: '$ gfortran -O2 main.f90 && ./a.out', pkg: 'gfortran', sample: 'program hello\n  implicit none\n  print *, "Hello, OpenCode!"\nend program hello\n' }),
  L({ id: 'bash', name: 'Bash', category: 'Core', ext: 'sh', runner: 'sim', hl: 'js', banner: '$ bash main.sh', pkg: 'bash', sample: '#!/usr/bin/env bash\nfor i in 1 2 3; do\n  echo "Hello, OpenCode! ($i)"\ndone\n' }),
  L({ id: 'lisp', name: 'Lisp', category: 'Core', ext: 'lisp', runner: 'sim', hl: 'lisp', banner: '$ sbcl --script main.lisp', pkg: 'sbcl', sample: ';; Common Lisp\n(dotimes (i 3)\n  (format t "Hello, OpenCode! (~d)~%" i))\n' }),
  L({ id: 'racket', name: 'Racket', category: 'Core', ext: 'rkt', runner: 'sim', hl: 'lisp', banner: '$ racket main.rkt', pkg: 'racket', sample: '#lang racket\n(for ([i (in-range 3)])\n  (printf "Hello, OpenCode! (~a)\\n" i))\n' }),
  L({ id: 'assembly', name: 'Assembly', category: 'Core', ext: 'asm', runner: 'sim', hl: 'asm', banner: '$ nasm -f elf64 main.asm && ld -o main main.o && ./main', pkg: 'nasm', sample: '; x86-64 Linux NASM\nglobal _start\n\nsection .text\n_start:\n    mov rax, 1          ; sys_write\n    mov rdi, 1          ; stdout\n    lea rsi, [msg]\n    mov rdx, 17         ; length\n    syscall\n\n    mov rax, 60         ; sys_exit\n    xor rdi, rdi\n    syscall\n\nsection .data\nmsg: db "Hello, OpenCode!", 10\n' }),

  /* ---------------- Web development & frontend ---------------- */
  L({ id: 'html5', name: 'HTML5', category: 'Web & Frontend', ext: 'html', runner: 'preview', hl: 'html', banner: '$ live-preview main.html', pkg: 'opencode-web-preview', sample: '<!DOCTYPE html>\n<html>\n<head>\n  <title>OpenCode</title>\n  <style>\n    body { font-family: sans-serif; display: grid; place-items: center; height: 100vh; margin: 0; background: #10141f; color: #38bdf8; }\n  </style>\n</head>\n<body>\n  <h1>Hello, OpenCode!</h1>\n</body>\n</html>\n' }),
  L({ id: 'css3', name: 'CSS3', category: 'Web & Frontend', ext: 'css', runner: 'preview', hl: 'css', banner: '$ live-preview style.css', pkg: 'opencode-web-preview', sample: '/* CSS3 — animated gradient card */\n.card {\n  padding: 2rem;\n  border-radius: 16px;\n  background: linear-gradient(135deg, #f97316, #e11d48);\n  color: white;\n  font: 700 24px sans-serif;\n  animation: float 2s ease-in-out infinite alternate;\n}\n@keyframes float {\n  from { transform: translateY(0); }\n  to   { transform: translateY(-14px); }\n}\n' }),
  L({ id: 'javascript', name: 'JavaScript', category: 'Web & Frontend', ext: 'js', runner: 'js', hl: 'js', banner: '$ node main.js', pkg: 'nodejs', sample: '// JavaScript\nconst greet = (name) => `Hello, ${name}!`;\n\nfor (let i = 1; i <= 3; i++) {\n  console.log(`${greet("OpenCode")} [${i}]`);\n}\n' }),
  L({ id: 'react', name: 'React', category: 'Web & Frontend', ext: 'jsx', runner: 'preview', hl: 'js', banner: '$ vite build && live-preview dist', pkg: 'react react-dom', sample: 'function App() {\n  const [n, setN] = React.useState(0);\n  return (\n    <div style={{ fontFamily: "sans-serif", textAlign: "center", paddingTop: 40 }}>\n      <h1>Hello, OpenCode!</h1>\n      <button onClick={() => setN(n + 1)}>Clicked {n} times</button>\n    </div>\n  );\n}\n\nReactDOM.createRoot(document.getElementById("root")).render(<App />);\n' }),
  L({ id: 'angular', name: 'Angular', category: 'Web & Frontend', ext: 'ts', runner: 'preview', hl: 'js', banner: '$ ng build && live-preview dist', pkg: '@angular/core', sample: '// Angular component\nimport { Component } from "@angular/core";\n\n@Component({\n  selector: "app-root",\n  template: `<h1>Hello, OpenCode!</h1>\n             <p>Angular {{ version }} live preview</p>`,\n})\nexport class AppComponent {\n  version = "17";\n}\n' }),
  L({ id: 'vuejs', name: 'VueJS', category: 'Web & Frontend', ext: 'vue', runner: 'preview', hl: 'html', banner: '$ vite build && live-preview dist', pkg: 'vue', sample: '<template>\n  <div id="app">\n    <h1>Hello, OpenCode!</h1>\n    <button @click="count++">Clicked {{ count }} times</button>\n  </div>\n</template>\n\n<script>\nexport default {\n  data() {\n    return { count: 0 };\n  },\n};\n</script>\n' }),

  /* ---------------- Backend frameworks ---------------- */
  L({ id: 'nodejs', name: 'NodeJS', category: 'Backend', ext: 'js', runner: 'js', hl: 'js', banner: '$ node main.js', pkg: 'nodejs npm', sample: '// NodeJS\nconst http = require("http");\n\nconst server = http.createServer((req, res) => {\n  res.end("Hello, OpenCode!");\n});\n\nserver.listen(3000, () => console.log("listening on :3000"));\nconsole.log("Hello, OpenCode!");\n' }),
  L({ id: 'express', name: 'Express', category: 'Backend', ext: 'js', runner: 'sim', hl: 'js', banner: '$ node server.js', pkg: 'express', sample: 'const express = require("express");\nconst app = express();\n\napp.get("/", (req, res) => res.send("Hello, OpenCode!"));\n\napp.listen(3000, () => console.log("Express listening on :3000"));\n' }),
  L({ id: 'nestjs', name: 'NestJS', category: 'Backend', ext: 'ts', runner: 'sim', hl: 'js', banner: '$ nest start', pkg: '@nestjs/core', sample: 'import { Controller, Get, Module } from "@nestjs/common";\n\n@Controller()\nexport class AppController {\n  @Get()\n  hello() {\n    return "Hello, OpenCode!";\n  }\n}\n' }),
  L({ id: 'fastify', name: 'Fastify', category: 'Backend', ext: 'js', runner: 'sim', hl: 'js', banner: '$ node server.js', pkg: 'fastify', sample: 'const fastify = require("fastify")();\n\nfastify.get("/", async () => "Hello, OpenCode!");\n\nfastify.listen({ port: 3000 }).then(() => console.log("Fastify listening on :3000"));\n' }),
  L({ id: 'django', name: 'Django', category: 'Backend', ext: 'py', runner: 'sim', hl: 'py', banner: '$ python manage.py runserver', pkg: 'django', sample: '# Django view\nfrom django.http import HttpResponse\n\ndef index(request):\n    return HttpResponse("Hello, OpenCode!")\n' }),
  L({ id: 'flask', name: 'Flask', category: 'Backend', ext: 'py', runner: 'sim', hl: 'py', banner: '$ flask run', pkg: 'flask', sample: 'from flask import Flask\n\napp = Flask(__name__)\n\n@app.route("/")\ndef index():\n    return "Hello, OpenCode!"\n\nif __name__ == "__main__":\n    app.run(port=5000)\n' }),
  L({ id: 'fastapi', name: 'FastAPI', category: 'Backend', ext: 'py', runner: 'sim', hl: 'py', banner: '$ uvicorn main:app --reload', pkg: 'fastapi uvicorn', sample: 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef index():\n    return {"message": "Hello, OpenCode!"}\n' }),
  L({ id: 'streamlit', name: 'Streamlit', category: 'Backend', ext: 'py', runner: 'sim', hl: 'py', banner: '$ streamlit run main.py', pkg: 'streamlit', sample: 'import streamlit as st\n\nst.title("Hello, OpenCode!")\nif st.button("Greet"):\n    st.success("Welcome to OpenCode!")\n' }),
  L({ id: 'springboot', name: 'Spring Boot', category: 'Backend', ext: 'java', runner: 'sim', hl: 'java', banner: '$ mvn -q spring-boot:run', pkg: 'spring-boot-starter-web', sample: '@SpringBootApplication\npublic class App {\n    public static void main(String[] args) {\n        SpringApplication.run(App.class, args);\n    }\n\n    @RestController\n    class Hello {\n        @GetMapping("/")\n        String index() { return "Hello, OpenCode!"; }\n    }\n}\n' }),

  /* ---------------- Databases & query languages ---------------- */
  L({ id: 'mysql', name: 'MySQL', category: 'Databases', ext: 'sql', runner: 'sim', hl: 'sql', banner: '$ mysql -u root -p < query.sql', pkg: 'mysql-server', sample: '-- MySQL\nCREATE TABLE greet (id INT PRIMARY KEY, msg VARCHAR(64));\nINSERT INTO greet VALUES (1, \'Hello, OpenCode!\');\nSELECT * FROM greet;\n' }),
  L({ id: 'postgresql', name: 'PostgreSQL', category: 'Databases', ext: 'sql', runner: 'sim', hl: 'sql', banner: '$ psql -f query.sql', pkg: 'postgresql-16', sample: '-- PostgreSQL\nCREATE TABLE greet (id serial PRIMARY KEY, msg text);\nINSERT INTO greet (msg) VALUES (\'Hello, OpenCode!\');\nSELECT * FROM greet;\n' }),
  L({ id: 'mongodb', name: 'MongoDB', category: 'Databases', ext: 'js', runner: 'sim', hl: 'js', banner: '$ mongosh --file query.js', pkg: 'mongodb-org', sample: '// MongoDB shell\ndb.greet.insertOne({ msg: "Hello, OpenCode!" });\ndb.greet.find().forEach(printjson);\n' }),
  L({ id: 'plsql', name: 'PL/SQL', category: 'Databases', ext: 'sql', runner: 'sim', hl: 'sql', banner: '$ sqlplus / @proc.sql', pkg: 'oracle-instantclient', sample: '-- PL/SQL\nBEGIN\n  DBMS_OUTPUT.PUT_LINE(\'Hello, OpenCode!\');\nEND;\n/\n' }),
  L({ id: 'redis', name: 'Redis', category: 'Databases', ext: 'txt', runner: 'sim', hl: 'sql', banner: '$ redis-cli < cmds.txt', pkg: 'redis-server', sample: '# Redis\nSET greeting "Hello, OpenCode!"\nGET greeting\nDEL greeting\n' }),

  /* ---------------- Hardware description languages ---------------- */
  L({ id: 'verilog', name: 'Verilog', category: 'Hardware', ext: 'v', runner: 'sim', hl: 'hdl', banner: '$ iverilog -o sim.vvp main.v && vvp sim.vvp', pkg: 'iverilog', sample: '// Verilog\nmodule hello;\n  initial begin\n    $display("Hello, OpenCode!");\n    $finish;\n  end\nendmodule\n' }),
  L({ id: 'vhdl', name: 'VHDL', category: 'Hardware', ext: 'vhd', runner: 'sim', hl: 'hdl', banner: '$ ghdl -a main.vhd && ghdl -e hello && ghdl -r hello', pkg: 'ghdl', sample: '-- VHDL\nentity hello is\nend hello;\n\narchitecture sim of hello is\nbegin\n  process\n  begin\n    report "Hello, OpenCode!";\n    wait;\n  end process;\nend sim;\n' }),
]

export const CODE_CATEGORIES = ['Core', 'Web & Frontend', 'Backend', 'Databases', 'Hardware'] as const

export function langById(id: string): CodeLang | undefined {
  return CODE_LANGS.find((l) => l.id === id)
}

/** installed = OS ships with every pack; only explicitly-removed ones are missing */
export function isLangInstalled(id: string, removed: string[]): boolean {
  return !removed.includes(id)
}
