import React, { useState } from 'react';
import {
  Cloud, Database, Layers, ChevronDown, ChevronRight, Plus, Search,
  GripVertical, Box, Share2, Server, Globe, Shield, Activity,
  HardDrive, Zap, Workflow, Bot, Sparkles, Router
} from 'lucide-react';
import {
  FaAws, FaMicrosoft, FaGoogle, FaDocker, FaReact
} from 'react-icons/fa6';
import {
  SiPostgresql, SiMysql, SiMongodb, SiRedis, SiApachecassandra, SiElasticsearch,
  SiSupabase, SiKubernetes, SiHelm, SiArgo, SiIstio, SiApachekafka, SiRabbitmq,
  SiNatsdotio, SiApachepulsar, SiNginx, SiTraefikproxy, SiKong, SiCloudflare,
  SiSpringboot, SiExpress, SiNestjs, SiFastapi, SiDjango, SiNextdotjs, SiAnthropic
} from 'react-icons/si';

export type CategoryName =
  | 'AWS' | 'Azure' | 'GCP' | 'Containers/DevOps' | 'Databases'
  | 'Messaging' | 'Gateways' | 'Frameworks' | 'AI/Vector DBs'
  | 'Cloud Providers' | 'Containers';

export interface PaletteItem {
  id: string;
  label: string;
  category: CategoryName;
  type: string;
  color: string;
  badgeColor: string;
  description: string;
  iconType: string;
}

export interface PaletteCategory {
  name: CategoryName;
  icon: React.ReactNode;
  items: PaletteItem[];
}

export const renderServiceIcon = (iconType: string, color: string, size = 16) => {
  const props = { size, style: { color } };
  switch (iconType) {
    case 'aws': return <FaAws {...props} />;
    case 'azure': return <FaMicrosoft {...props} />;
    case 'gcp': return <FaGoogle {...props} />;
    case 'k8s': return <SiKubernetes {...props} />;
    case 'docker': return <FaDocker {...props} />;
    case 'helm': return <SiHelm {...props} />;
    case 'argocd': return <SiArgo {...props} />;
    case 'istio': return <SiIstio {...props} />;
    case 'postgres': return <SiPostgresql {...props} />;
    case 'mysql': return <SiMysql {...props} />;
    case 'mongodb': return <SiMongodb {...props} />;
    case 'redis': return <SiRedis {...props} />;
    case 'cassandra': return <SiApachecassandra {...props} />;
    case 'elasticsearch': return <SiElasticsearch {...props} />;
    case 'supabase': return <SiSupabase {...props} />;
    case 'kafka': return <SiApachekafka {...props} />;
    case 'rabbitmq': return <SiRabbitmq {...props} />;
    case 'nats': return <SiNatsdotio {...props} />;
    case 'pulsar': return <SiApachepulsar {...props} />;
    case 'nginx': return <SiNginx {...props} />;
    case 'traefik': return <SiTraefikproxy {...props} />;
    case 'kong': return <SiKong {...props} />;
    case 'cloudflare': return <SiCloudflare {...props} />;
    case 'springboot': return <SiSpringboot {...props} />;
    case 'express': return <SiExpress {...props} />;
    case 'nestjs': return <SiNestjs {...props} />;
    case 'fastapi': return <SiFastapi {...props} />;
    case 'django': return <SiDjango {...props} />;
    case 'react': return <FaReact {...props} />;
    case 'nextjs': return <SiNextdotjs {...props} />;
    case 'anthropic': return <SiAnthropic {...props} />;
    case 'openai': return <Bot {...props} />;
    case 'server': return <Server {...props} />;
    case 'lambda': return <Zap {...props} />;
    case 'storage': return <HardDrive {...props} />;
    case 'database': return <Database {...props} />;
    case 'queue': return <Workflow {...props} />;
    case 'network': return <Globe {...props} />;
    case 'shield': return <Shield {...props} />;
    case 'activity': return <Activity {...props} />;
    case 'router': return <Router {...props} />;
    case 'sparkles': return <Sparkles {...props} />;
    default: return <Cloud {...props} />;
  }
};

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: 'AWS',
    icon: <FaAws size={16} className="text-amber-500" />,
    items: [
      {
            "id": "aws-ec2",
            "label": "EC2",
            "category": "AWS",
            "type": "cloud",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Elastic Compute Cloud virtual servers",
            "iconType": "server"
      },
      {
            "id": "aws-lambda",
            "label": "Lambda",
            "category": "AWS",
            "type": "cloud",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Serverless compute execution service",
            "iconType": "lambda"
      },
      {
            "id": "aws-s3",
            "label": "S3",
            "category": "AWS",
            "type": "cloud",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "Simple Storage Service object store",
            "iconType": "storage"
      },
      {
            "id": "aws-rds",
            "label": "RDS",
            "category": "AWS",
            "type": "cloud",
            "color": "#3b82f6",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Managed Relational Database Service",
            "iconType": "database"
      },
      {
            "id": "aws-dynamodb",
            "label": "DynamoDB",
            "category": "AWS",
            "type": "cloud",
            "color": "#3b82f6",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Managed NoSQL key-value database",
            "iconType": "database"
      },
      {
            "id": "aws-ecs",
            "label": "ECS",
            "category": "AWS",
            "type": "cloud",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Elastic Container Service orchestrator",
            "iconType": "docker"
      },
      {
            "id": "aws-eks",
            "label": "EKS",
            "category": "AWS",
            "type": "cloud",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Elastic Kubernetes Service cluster",
            "iconType": "k8s"
      },
      {
            "id": "aws-apigateway",
            "label": "API Gateway",
            "category": "AWS",
            "type": "cloud",
            "color": "#8b5cf6",
            "badgeColor": "bg-purple-100 text-purple-800 border-purple-200",
            "description": "Managed HTTP/REST API Gateway endpoint",
            "iconType": "router"
      },
      {
            "id": "aws-cloudfront",
            "label": "CloudFront",
            "category": "AWS",
            "type": "cloud",
            "color": "#8b5cf6",
            "badgeColor": "bg-purple-100 text-purple-800 border-purple-200",
            "description": "Global CDN Content Delivery Network",
            "iconType": "network"
      },
      {
            "id": "aws-sqs",
            "label": "SQS",
            "category": "AWS",
            "type": "cloud",
            "color": "#ec4899",
            "badgeColor": "bg-pink-100 text-pink-800 border-pink-200",
            "description": "Simple Queue Service message broker",
            "iconType": "queue"
      },
      {
            "id": "aws-sns",
            "label": "SNS",
            "category": "AWS",
            "type": "cloud",
            "color": "#ec4899",
            "badgeColor": "bg-pink-100 text-pink-800 border-pink-200",
            "description": "Simple Notification Service pub/sub",
            "iconType": "queue"
      },
      {
            "id": "aws-vpc",
            "label": "VPC",
            "category": "AWS",
            "type": "cloud",
            "color": "#06b6d4",
            "badgeColor": "bg-cyan-100 text-cyan-800 border-cyan-200",
            "description": "Virtual Private Cloud isolated network",
            "iconType": "shield"
      },
      {
            "id": "aws-route53",
            "label": "Route53",
            "category": "AWS",
            "type": "cloud",
            "color": "#8b5cf6",
            "badgeColor": "bg-purple-100 text-purple-800 border-purple-200",
            "description": "Scalable DNS domain routing service",
            "iconType": "network"
      },
      {
            "id": "aws-elasticache",
            "label": "ElastiCache",
            "category": "AWS",
            "type": "cloud",
            "color": "#ef4444",
            "badgeColor": "bg-rose-100 text-rose-800 border-rose-200",
            "description": "In-memory Redis/Memcached cache cluster",
            "iconType": "redis"
      },
      {
            "id": "aws-cloudwatch",
            "label": "CloudWatch",
            "category": "AWS",
            "type": "cloud",
            "color": "#64748b",
            "badgeColor": "bg-slate-100 text-slate-800 border-slate-200",
            "description": "Monitoring, logs, and observability",
            "iconType": "activity"
      }
]
  },
  {
    name: 'Azure',
    icon: <FaMicrosoft size={16} className="text-blue-600" />,
    items: [
      {
            "id": "azure-appservice",
            "label": "App Service",
            "category": "Azure",
            "type": "cloud",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Managed web application hosting service",
            "iconType": "azure"
      },
      {
            "id": "azure-functions",
            "label": "Azure Functions",
            "category": "Azure",
            "type": "cloud",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Event-driven serverless compute service",
            "iconType": "lambda"
      },
      {
            "id": "azure-aks",
            "label": "AKS",
            "category": "Azure",
            "type": "cloud",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Azure Kubernetes Service cluster",
            "iconType": "k8s"
      },
      {
            "id": "azure-cosmosdb",
            "label": "Cosmos DB",
            "category": "Azure",
            "type": "cloud",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "Globally distributed multi-model NoSQL DB",
            "iconType": "database"
      },
      {
            "id": "azure-blob",
            "label": "Blob Storage",
            "category": "Azure",
            "type": "cloud",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Massively scalable object storage",
            "iconType": "storage"
      },
      {
            "id": "azure-servicebus",
            "label": "Service Bus",
            "category": "Azure",
            "type": "cloud",
            "color": "#8b5cf6",
            "badgeColor": "bg-purple-100 text-purple-800 border-purple-200",
            "description": "Enterprise messaging broker queue",
            "iconType": "queue"
      },
      {
            "id": "azure-sql",
            "label": "Azure SQL",
            "category": "Azure",
            "type": "cloud",
            "color": "#4f46e5",
            "badgeColor": "bg-indigo-100 text-indigo-800 border-indigo-200",
            "description": "Managed relational SQL database service",
            "iconType": "database"
      }
]
  },
  {
    name: 'GCP',
    icon: <FaGoogle size={16} className="text-red-500" />,
    items: [
      {
            "id": "gcp-cloudrun",
            "label": "Cloud Run",
            "category": "GCP",
            "type": "cloud",
            "color": "#ea4335",
            "badgeColor": "bg-red-100 text-red-800 border-red-200",
            "description": "Fully managed container execution platform",
            "iconType": "docker"
      },
      {
            "id": "gcp-gke",
            "label": "GKE",
            "category": "GCP",
            "type": "cloud",
            "color": "#4285f4",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Google Kubernetes Engine cluster",
            "iconType": "k8s"
      },
      {
            "id": "gcp-functions",
            "label": "Cloud Functions",
            "category": "GCP",
            "type": "cloud",
            "color": "#ea4335",
            "badgeColor": "bg-red-100 text-red-800 border-red-200",
            "description": "Serverless Functions as a Service",
            "iconType": "lambda"
      },
      {
            "id": "gcp-bigquery",
            "label": "BigQuery",
            "category": "GCP",
            "type": "cloud",
            "color": "#4285f4",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Serverless enterprise data warehouse",
            "iconType": "database"
      },
      {
            "id": "gcp-storage",
            "label": "Cloud Storage",
            "category": "GCP",
            "type": "cloud",
            "color": "#f59e0b",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Unified object storage service",
            "iconType": "storage"
      },
      {
            "id": "gcp-pubsub",
            "label": "Pub/Sub",
            "category": "GCP",
            "type": "cloud",
            "color": "#8b5cf6",
            "badgeColor": "bg-purple-100 text-purple-800 border-purple-200",
            "description": "Asynchronous event ingestion and messaging",
            "iconType": "queue"
      },
      {
            "id": "gcp-sql",
            "label": "Cloud SQL",
            "category": "GCP",
            "type": "cloud",
            "color": "#4285f4",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Fully managed relational DB service",
            "iconType": "database"
      }
]
  },
  {
    name: 'Containers/DevOps',
    icon: <Box size={16} className="text-blue-500" />,
    items: [
      {
            "id": "k8s",
            "label": "Kubernetes",
            "category": "Containers/DevOps",
            "type": "k8s",
            "color": "#3b82f6",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Production-grade container orchestrator",
            "iconType": "k8s"
      },
      {
            "id": "docker",
            "label": "Docker",
            "category": "Containers/DevOps",
            "type": "docker",
            "color": "#0ea5e9",
            "badgeColor": "bg-cyan-100 text-cyan-800 border-cyan-200",
            "description": "Container runtime and image packaging",
            "iconType": "docker"
      },
      {
            "id": "helm",
            "label": "Helm",
            "category": "Containers/DevOps",
            "type": "helm",
            "color": "#0f172a",
            "badgeColor": "bg-slate-200 text-slate-800 border-slate-300",
            "description": "Kubernetes package deployment manager",
            "iconType": "helm"
      },
      {
            "id": "argocd",
            "label": "ArgoCD",
            "category": "Containers/DevOps",
            "type": "argocd",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Declarative GitOps continuous delivery tool",
            "iconType": "argocd"
      },
      {
            "id": "istio",
            "label": "Istio",
            "category": "Containers/DevOps",
            "type": "istio",
            "color": "#466bb0",
            "badgeColor": "bg-indigo-100 text-indigo-800 border-indigo-200",
            "description": "Service mesh for connecting microservices",
            "iconType": "istio"
      }
]
  },
  {
    name: 'Databases',
    icon: <Database size={16} className="text-emerald-500" />,
    items: [
      {
            "id": "postgres",
            "label": "PostgreSQL",
            "category": "Databases",
            "type": "postgres",
            "color": "#4f46e5",
            "badgeColor": "bg-indigo-100 text-indigo-800 border-indigo-200",
            "description": "Advanced open source relational SQL DB",
            "iconType": "postgres"
      },
      {
            "id": "mysql",
            "label": "MySQL",
            "category": "Databases",
            "type": "mysql",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Popular relational SQL database system",
            "iconType": "mysql"
      },
      {
            "id": "mongodb",
            "label": "MongoDB",
            "category": "Databases",
            "type": "mongodb",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "Document-oriented NoSQL database",
            "iconType": "mongodb"
      },
      {
            "id": "redis",
            "label": "Redis",
            "category": "Databases",
            "type": "redis",
            "color": "#ef4444",
            "badgeColor": "bg-rose-100 text-rose-800 border-rose-200",
            "description": "In-memory data structure store and cache",
            "iconType": "redis"
      },
      {
            "id": "cassandra",
            "label": "Cassandra",
            "category": "Databases",
            "type": "cassandra",
            "color": "#334155",
            "badgeColor": "bg-slate-200 text-slate-800 border-slate-300",
            "description": "Distributed wide-column NoSQL store",
            "iconType": "cassandra"
      },
      {
            "id": "elasticsearch",
            "label": "Elasticsearch",
            "category": "Databases",
            "type": "elasticsearch",
            "color": "#f59e0b",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Distributed search and analytics engine",
            "iconType": "elasticsearch"
      },
      {
            "id": "supabase",
            "label": "Supabase",
            "category": "Databases",
            "type": "supabase",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "Open source Firebase alternative Postgres DB",
            "iconType": "supabase"
      },
      {
            "id": "sqlite",
            "label": "SQLite",
            "category": "Databases",
            "type": "sqlite",
            "color": "#0284c7",
            "badgeColor": "bg-sky-100 text-sky-800 border-sky-200",
            "description": "Lightweight embedded SQL database engine",
            "iconType": "database"
      }
]
  },
  {
    name: 'Messaging',
    icon: <Share2 size={16} className="text-purple-500" />,
    items: [
      {
            "id": "kafka",
            "label": "Kafka",
            "category": "Messaging",
            "type": "kafka",
            "color": "#334155",
            "badgeColor": "bg-slate-200 text-slate-800 border-slate-300",
            "description": "Apache Kafka distributed event streaming",
            "iconType": "kafka"
      },
      {
            "id": "rabbitmq",
            "label": "RabbitMQ",
            "category": "Messaging",
            "type": "rabbitmq",
            "color": "#ea580c",
            "badgeColor": "bg-orange-100 text-orange-800 border-orange-200",
            "description": "Enterprise AMQP message queue broker",
            "iconType": "rabbitmq"
      },
      {
            "id": "nats",
            "label": "NATS",
            "category": "Messaging",
            "type": "nats",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "High-performance cloud native messaging",
            "iconType": "nats"
      },
      {
            "id": "pulsar",
            "label": "Pulsar",
            "category": "Messaging",
            "type": "pulsar",
            "color": "#2563eb",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Apache Pulsar distributed pub-sub messaging",
            "iconType": "pulsar"
      }
]
  },
  {
    name: 'Gateways',
    icon: <Router size={16} className="text-indigo-500" />,
    items: [
      {
            "id": "nginx",
            "label": "Nginx",
            "category": "Gateways",
            "type": "nginx",
            "color": "#15803d",
            "badgeColor": "bg-green-100 text-green-800 border-green-200",
            "description": "High-performance web server and reverse proxy",
            "iconType": "nginx"
      },
      {
            "id": "traefik",
            "label": "Traefik",
            "category": "Gateways",
            "type": "traefik",
            "color": "#06b6d4",
            "badgeColor": "bg-cyan-100 text-cyan-800 border-cyan-200",
            "description": "Modern cloud-native reverse proxy and ingress",
            "iconType": "traefik"
      },
      {
            "id": "kong",
            "label": "Kong",
            "category": "Gateways",
            "type": "kong",
            "color": "#0f172a",
            "badgeColor": "bg-slate-200 text-slate-800 border-slate-300",
            "description": "Cloud-native API gateway and mesh platform",
            "iconType": "kong"
      },
      {
            "id": "cloudflare",
            "label": "Cloudflare",
            "category": "Gateways",
            "type": "cloudflare",
            "color": "#f97316",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Global Edge Proxy, WAF, and CDN platform",
            "iconType": "cloudflare"
      }
]
  },
  {
    name: 'Frameworks',
    icon: <Layers size={16} className="text-teal-500" />,
    items: [
      {
            "id": "springBoot",
            "label": "Spring Boot",
            "category": "Frameworks",
            "type": "springBoot",
            "color": "#10b981",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "Java/Kotlin enterprise backend framework",
            "iconType": "springboot"
      },
      {
            "id": "express",
            "label": "Express",
            "category": "Frameworks",
            "type": "express",
            "color": "#525252",
            "badgeColor": "bg-neutral-200 text-neutral-800 border-neutral-300",
            "description": "Fast, unopinionated web framework for Node.js",
            "iconType": "express"
      },
      {
            "id": "nestjs",
            "label": "NestJS",
            "category": "Frameworks",
            "type": "nestjs",
            "color": "#e11d48",
            "badgeColor": "bg-rose-100 text-rose-800 border-rose-200",
            "description": "Progressive TypeScript server-side framework",
            "iconType": "nestjs"
      },
      {
            "id": "fastapi",
            "label": "FastAPI",
            "category": "Frameworks",
            "type": "fastapi",
            "color": "#059669",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "High-performance Python async API framework",
            "iconType": "fastapi"
      },
      {
            "id": "django",
            "label": "Django",
            "category": "Frameworks",
            "type": "django",
            "color": "#0f766e",
            "badgeColor": "bg-teal-100 text-teal-800 border-teal-200",
            "description": "Full-featured Python web framework",
            "iconType": "django"
      },
      {
            "id": "react",
            "label": "React",
            "category": "Frameworks",
            "type": "react",
            "color": "#06b6d4",
            "badgeColor": "bg-cyan-100 text-cyan-800 border-cyan-200",
            "description": "Component-based frontend UI library",
            "iconType": "react"
      },
      {
            "id": "nextjs",
            "label": "Next.js",
            "category": "Frameworks",
            "type": "nextjs",
            "color": "#0f172a",
            "badgeColor": "bg-slate-200 text-slate-800 border-slate-300",
            "description": "Full-stack React framework with SSR",
            "iconType": "nextjs"
      }
]
  },
  {
    name: 'AI/Vector DBs',
    icon: <Sparkles size={16} className="text-rose-500" />,
    items: [
      {
            "id": "openai",
            "label": "OpenAI",
            "category": "AI/Vector DBs",
            "type": "openai",
            "color": "#10a37f",
            "badgeColor": "bg-emerald-100 text-emerald-800 border-emerald-200",
            "description": "GPT-4o and embeddings API intelligence node",
            "iconType": "openai"
      },
      {
            "id": "anthropic",
            "label": "Anthropic Claude",
            "category": "AI/Vector DBs",
            "type": "anthropic",
            "color": "#d97706",
            "badgeColor": "bg-amber-100 text-amber-800 border-amber-200",
            "description": "Claude 3.5 Sonnet advanced reasoning LLM node",
            "iconType": "anthropic"
      },
      {
            "id": "pinecone",
            "label": "Pinecone",
            "category": "AI/Vector DBs",
            "type": "pinecone",
            "color": "#3b82f6",
            "badgeColor": "bg-blue-100 text-blue-800 border-blue-200",
            "description": "Managed vector database for semantic search",
            "iconType": "database"
      },
      {
            "id": "qdrant",
            "label": "Qdrant",
            "category": "AI/Vector DBs",
            "type": "qdrant",
            "color": "#ef4444",
            "badgeColor": "bg-rose-100 text-rose-800 border-rose-200",
            "description": "High-performance vector similarity search engine",
            "iconType": "database"
      }
]
  }
];


interface NodePaletteProps {
  onAddNode?: (item: PaletteItem) => void;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onAddNode }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    'AWS': true,
    'Azure': true,
    'GCP': true,
    'Containers/DevOps': true,
    'Databases': true,
    'Messaging': true,
    'Gateways': true,
    'Frameworks': true,
    'AI/Vector DBs': true,
  });

  const toggleCategory = (name: string) => {
    setOpenCategories((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  const expandAll = () => {
    const allOpen: Record<string, boolean> = {};
    PALETTE_CATEGORIES.forEach((cat) => {
      allOpen[cat.name] = true;
    });
    setOpenCategories(allOpen);
  };

  const collapseAll = () => {
    const allClosed: Record<string, boolean> = {};
    PALETTE_CATEGORIES.forEach((cat) => {
      allClosed[cat.name] = false;
    });
    setOpenCategories(allClosed);
  };

  const handleDragStart = (event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/reactflow/type', item.type);
    event.dataTransfer.setData('application/reactflow/label', item.label);
    event.dataTransfer.setData('application/reactflow/category', item.category);
    event.dataTransfer.setData('application/reactflow/color', item.color);
    event.dataTransfer.setData('application/reactflow/iconType', item.iconType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const filteredCategories = PALETTE_CATEGORIES.map((category) => {
    if (!searchQuery.trim()) return category;
    const q = searchQuery.toLowerCase();
    const matchesCategory = category.name.toLowerCase().includes(q);
    const matchedItems = category.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
    if (matchesCategory) return category;
    return {
      ...category,
      items: matchedItems,
    };
  }).filter((category) => category.items.length > 0);

  const totalComponentCount = PALETTE_CATEGORIES.reduce(
    (acc, cat) => acc + cat.items.length,
    0
  );

  return (
    <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 select-none shadow-sm">
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/80">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Layers size={14} className="text-slate-600" />
            Node Palette
          </h2>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
            {totalComponentCount} Services
          </span>
        </div>

        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search AWS, Azure, K8s, AI..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-700"
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>Categorized Services</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="hover:text-blue-600 font-semibold transition-colors"
            >
              Expand All
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={collapseAll}
              className="hover:text-blue-600 font-semibold transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filteredCategories.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No services match your search
          </div>
        ) : (
          filteredCategories.map((category) => {
            const isOpen = openCategories[category.name] ?? true;
            return (
              <div key={category.name} className="py-1">
                <button
                  type="button"
                  onClick={() => toggleCategory(category.name)}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    {category.icon}
                    <span className="text-xs font-bold text-slate-800">
                      {category.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200">
                      {category.items.length}
                    </span>
                    {isOpen ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={14} className="text-slate-400" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-2.5 pb-2 pt-1 space-y-1.5">
                    {category.items.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item)}
                        onClick={() => onAddNode?.(item)}
                        className="group flex items-center justify-between p-2 rounded-lg border border-slate-200/80 bg-white hover:border-blue-300 hover:shadow-sm hover:bg-slate-50/70 cursor-grab active:cursor-grabbing transition-all"
                        title="Drag onto canvas or click + to add"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="text-slate-300 group-hover:text-slate-500 transition-colors">
                            <GripVertical size={13} />
                          </div>
                          <div className="w-6 h-6 rounded-md bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0">
                            {renderServiceIcon(item.iconType, item.color, 14)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-800 truncate">
                                {item.label}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {item.description}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddNode?.(item);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-100 text-blue-600 transition-all shrink-0"
                          title={`Add ${item.label} to canvas`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-2.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 text-center font-medium">
        Drag & drop onto canvas or click <span className="font-bold text-blue-600">+</span> to add
      </div>
    </div>
  );
};
