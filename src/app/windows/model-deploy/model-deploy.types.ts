export interface ModelDeployLabel {
  object_id: string;
  object_name: string;
}

/** Host-owned model payload consumed by the existing deployment windows. */
export interface ModelDeployDetail {
  id: string;
  name: string;
  description: string;
  content: string;
  author: string;
  author_name: string;
  pic_url: string;
  file_url: string;
  model_size: string;
  be_public: string;
  deploy_num: string;
  view_num: string;
  like_num: string;
  follow_num: string;
  priority: string;
  scenario: string;
  precision: string;
  ai_framework: string;
  model_format: string;
  task: string;
  preparation: string[];
  checksum: string;
  attr: { iou: string; conf: string };
  is_enabled: boolean;
  version: string;
  created: string;
  deleted: string;
  adapteds: string[];
  labels: ModelDeployLabel[];
  uniform_types: string[];
}
