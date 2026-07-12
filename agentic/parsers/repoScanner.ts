import * as fs from 'fs';
import * as path from 'path';

export interface ReactFlowNode {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: {
        label: string;
        type?: string;
        metadata?: any;
    };
}

export interface ReactFlowEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    type?: string;
}

export interface ReactFlowGraph {
    nodes: ReactFlowNode[];
    edges: ReactFlowEdge[];
}

function findFiles(dir: string, extension: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findFiles(filePath, extension, fileList);
        } else if (filePath.endsWith(extension)) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

export function scanRepository(baseDir: string): ReactFlowGraph {
    const nodes: ReactFlowNode[] = [];
    const edges: ReactFlowEdge[] = [];

    let currentX = 0;
    let currentY = 0;
    const increment = 200;

    const javaFiles = findFiles(baseDir, '.java');
    const ymlFiles = findFiles(baseDir, '.yml');

    const controllers: string[] = [];
    const services: string[] = [];
    const databases: string[] = [];

    // Scan Java files for controllers and services
    for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const fileName = path.basename(file, '.java');
        
        if (content.includes('@RestController')) {
            const id = `controller-${fileName}`;
            controllers.push(id);
            nodes.push({
                id,
                type: 'controllerNode',
                position: { x: currentX, y: currentY },
                data: { label: fileName, type: 'Controller', metadata: { filePath: file } }
            });
            currentX += increment;
            if (currentX > 800) { currentX = 0; currentY += increment; }
        } else if (content.includes('@Service')) {
            const id = `service-${fileName}`;
            services.push(id);
            nodes.push({
                id,
                type: 'serviceNode',
                position: { x: currentX, y: currentY },
                data: { label: fileName, type: 'Service', metadata: { filePath: file } }
            });
            currentX += increment;
            if (currentX > 800) { currentX = 0; currentY += increment; }
        }
    }

    // Scan yml files for databases
    for (const file of ymlFiles) {
        if (path.basename(file) === 'application.yml' || path.basename(file) === 'application.yaml') {
            const content = fs.readFileSync(file, 'utf-8');
            if (content.includes('url:') || content.includes('jdbc:')) {
                const id = `database-${path.basename(file)}`;
                databases.push(id);
                nodes.push({
                    id,
                    type: 'databaseNode',
                    position: { x: currentX, y: currentY },
                    data: { label: 'Database', type: 'Database', metadata: { filePath: file } }
                });
                currentX += increment;
                if (currentX > 800) { currentX = 0; currentY += increment; }
            }
        }
    }

    // Construct edges based on naive content matching
    for (const file of javaFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const fileName = path.basename(file, '.java');

        if (content.includes('@RestController')) {
            const sourceId = `controller-${fileName}`;
            for (const serviceId of services) {
                const serviceName = serviceId.replace('service-', '');
                if (content.includes(serviceName)) {
                    edges.push({
                        id: `edge-${sourceId}-${serviceId}`,
                        source: sourceId,
                        target: serviceId,
                        label: 'uses'
                    });
                }
            }
        }

        if (content.includes('@Service')) {
            const sourceId = `service-${fileName}`;
            for (const dbId of databases) {
                // If a service uses a Repository or Jdbc template
                if (content.includes('Repository') || content.includes('Jdbc')) {
                    edges.push({
                        id: `edge-${sourceId}-${dbId}`,
                        source: sourceId,
                        target: dbId,
                        label: 'persists'
                    });
                }
            }
        }
    }

    return { nodes, edges };
}
