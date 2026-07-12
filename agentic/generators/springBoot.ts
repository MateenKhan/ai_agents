export interface RFNode {
  id: string;
  type: string;
  data: Record<string, any>;
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
}

export interface RFGraph {
  nodes: RFNode[];
  edges: RFEdge[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Parses a React Flow JSON graph and generates Spring Boot boilerplate code.
 * Extracts SpringBootNode and DatabaseNode to wire up application.yml and 
 * generates boilerplate @RestController and @Service classes.
 */
export function generateSpringBootProject(graph: RFGraph): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  if (!graph || !graph.nodes) {
    return files;
  }

  const springNodes = graph.nodes.filter(n => n.type === 'SpringBootNode');
  const dbNodes = graph.nodes.filter(n => n.type === 'DatabaseNode');
  
  if (springNodes.length === 0) {
    return files;
  }

  for (const springNode of springNodes) {
    const appName = springNode.data?.name || 'app';
    const packageName = springNode.data?.packageName || 'com.example.demo';
    const packagePath = packageName.replace(/\./g, '/');
    const basePath = `${appName}/src/main/java/${packagePath}`;
    const resourcesPath = `${appName}/src/main/resources`;

    // Find database connections for this Spring Boot node
    let connectedDbs: RFNode[] = [];
    if (graph.edges) {
      const connectedEdges = graph.edges.filter(e => e.source === springNode.id || e.target === springNode.id);
      const connectedDbIds = connectedEdges.map(e => e.source === springNode.id ? e.target : e.source);
      connectedDbs = dbNodes.filter(db => connectedDbIds.includes(db.id));
    }

    // Generate application.yml
    let applicationYml = `spring:\n  application:\n    name: ${appName}\n`;
    
    if (connectedDbs.length > 0) {
      const db = connectedDbs[0];
      const dbType = db.data?.type || 'postgres';
      const dbName = db.data?.name || 'postgres';
      const dbHost = db.data?.host || 'localhost';
      const dbPort = db.data?.port || '5432';
      const dbUser = db.data?.username || 'postgres';
      const dbPass = db.data?.password || 'password';

      if (dbType.toLowerCase() === 'postgres' || dbType.toLowerCase() === 'postgresql') {
        applicationYml += `
  datasource:
    url: jdbc:postgresql://${dbHost}:${dbPort}/${dbName}
    username: ${dbUser}
    password: ${dbPass}
    driver-class-name: org.postgresql.Driver
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
`;
      } else {
        applicationYml += `
  datasource:
    url: jdbc:${dbType}://${dbHost}:${dbPort}/${dbName}
    username: ${dbUser}
    password: ${dbPass}
`;
      }
    }

    files.push({
      path: `${resourcesPath}/application.yml`,
      content: applicationYml.trim()
    });

    // Generate Main Application Class
    const mainClassName = appName.charAt(0).toUpperCase() + appName.slice(1) + 'Application';
    const mainClassContent = `package ${packageName};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${mainClassName} {

    public static void main(String[] args) {
        SpringApplication.run(${mainClassName}.class, args);
    }
}
`;
    files.push({
      path: `${basePath}/${mainClassName}.java`,
      content: mainClassContent
    });

    // Generate Boilerplate Controller
    const controllerName = 'DefaultController';
    const controllerContent = `package ${packageName}.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ${packageName}.service.DefaultService;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/api")
public class ${controllerName} {

    @Autowired
    private DefaultService defaultService;

    @GetMapping("/hello")
    public String sayHello() {
        return defaultService.getGreeting();
    }
}
`;
    files.push({
      path: `${basePath}/controller/${controllerName}.java`,
      content: controllerContent
    });

    // Generate Boilerplate Service
    const serviceName = 'DefaultService';
    const serviceContent = `package ${packageName}.service;

import org.springframework.stereotype.Service;

@Service
public class ${serviceName} {

    public String getGreeting() {
        return "Hello from Spring Boot!";
    }
}
`;
    files.push({
      path: `${basePath}/service/${serviceName}.java`,
      content: serviceContent
    });
  }

  return files;
}
