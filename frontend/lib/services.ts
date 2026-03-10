import { api } from "./api";

export interface Server {
    id: number;
    name: string;
    ip_address: string;
    status: string;
    ssh_user: string;
    ssh_private_key_path: string | null;
    ssh_status?: string; // pending, deployed, failed
    has_ssh_password?: boolean; // Indica si tiene contraseña SSH guardada
}

export interface Metric {
    id: number;
    server_id: number;
    cpu_usage: string;
    memory_usage: string;
    disk_usage: string;
    gpu_usage: string;
    timestamp: string;
}

export interface Playbook {
    id: number;
    name: string;
    playbook: string;
    inventory: string;
}

export interface Execution {
    id: number;
    playbook_id: number;
    user_id: number;
    user_username?: string;
    servers: number[];
    executed_at: string;
    state: string;
}

export interface User {
    id: number;
    username: string;
    email: string;
    is_admin: number;
    is_active: number;
    must_change_password: boolean;
    system_uid: number;
    created_at: string;
}

// Servidores
export const serversService = {
    async getAll() {
        const response = await api.get<Server[]>("/servers/");
        return response.data;
    },

    async getById(id: number) {
        const response = await api.get<Server>(`/servers/${id}`);
        return response.data;
    },

    async create(data: {
        name: string;
        ip_address: string;
        ssh_user: string;
        ssh_password: string;
    }) {
        const response = await api.post<Server>("/servers/", data);
        return response.data;
    },

    async updateStatus(id: number, status: string) {
        const response = await api.put<Server>(`/servers/${id}/status`, {
            status,
        });
        return response.data;
    },

    async setOnline(id: number) {
        const response = await api.put<Server>(`/servers/${id}/online`);
        return response.data;
    },

    async setOffline(id: number) {
        const response = await api.put<Server>(`/servers/${id}/offline`);
        return response.data;
    },

    async delete(id: number) {
        await api.delete(`/servers/${id}`);
    },

    async updateName(id: number, name: string) {
        const response = await api.put<Server>(
            `/servers/${id}/name?name=${encodeURIComponent(name)}`,
        );
        return response.data;
    },

    async updateIp(id: number, ip_address: string) {
        const response = await api.put<Server>(
            `/servers/${id}/ip?ip_address=${encodeURIComponent(ip_address)}`,
        );
        return response.data;
    },

    async syncUsers(id: number) {
        const response = await api.post(`/servers/${id}/sync-users`);
        return response.data;
    },

    async retrySSHDeploy(id: number, password: string) {
        const response = await api.post(`/servers/${id}/retry-ssh-deploy`, {
            ssh_password: password,
            ssh_port: 22,
        });
        return response.data;
    },

    async saveSSHPassword(id: number, password: string) {
        const response = await api.patch(`/servers/${id}/ssh-password`, {
            ssh_password: password,
        });
        return response.data;
    },

    async getMetrics(id: number) {
        const response = await api.get<Metric[]>(`/servers/${id}/metrics`);
        return response.data;
    },

    async countTotal() {
        const response = await api.get<{ count: number }>(
            "/servers/count/total",
        );
        return response.data;
    },

    async countByStatus(status: string) {
        const response = await api.get<{ count: number }>(
            `/servers/count/by-status/${status}`,
        );
        return response.data;
    },
};

// Playbooks
export const playbooksService = {
    async getAll() {
        const response = await api.get<Playbook[]>("/ansible/playbooks");
        return response.data;
    },

    async getById(id: number) {
        const response = await api.get<Playbook>(`/ansible/playbooks/${id}`);
        return response.data;
    },

    async uploadPlaybookFile(file: File) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post<{
            filename: string;
            path: string;
            size: number;
        }>("/ansible/upload/playbook", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });
        return response.data;
    },

    async create(data: { name: string; playbook: string; inventory: string }) {
        const response = await api.post<Playbook>("/ansible/playbooks", data);
        return response.data;
    },

    async update(id: number, data: Partial<Playbook>) {
        const response = await api.patch<Playbook>(
            `/ansible/playbooks/${id}`,
            data,
        );
        return response.data;
    },

    async delete(id: number) {
        await api.delete(`/ansible/playbooks/${id}`);
    },

    async run(id: number, serverIds: number[], dryRun: boolean = false) {
        const response = await api.post(`/ansible/playbooks/${id}/run`, {
            server_ids: serverIds,
            dry_run: dryRun,
        });
        return response.data;
    },

    async count() {
        const response = await api.get<{ count: number }>(
            "/ansible/playbooks/count",
        );
        return response.data;
    },
};

// Ejecuciones
export const executionsService = {
    async getAll() {
        const response = await api.get<Execution[]>("/executions/");
        return response.data;
    },

    async getById(id: number) {
        const response = await api.get<Execution>(`/executions/${id}`);
        return response.data;
    },

    async getByPlaybook(playbookId: number) {
        const response = await api.get<Execution[]>(
            `/executions/by-playbook/${playbookId}`,
        );
        return response.data;
    },

    async getByState(state: string) {
        const response = await api.get<Execution[]>(
            `/executions/by-state/${state}`,
        );
        return response.data;
    },

    async countTotal() {
        const response = await api.get<{ count: number }>(
            "/executions/count/total",
        );
        return response.data;
    },

    async countByState(state: string) {
        const response = await api.get<{ count: number }>(
            `/executions/count/by-state/${state}`,
        );
        return response.data;
    },
};

// Usuarios
export const usersService = {
    async getAll() {
        const response = await api.get<User[]>("/users/");
        return response.data;
    },

    async getById(id: number) {
        const response = await api.get<User>(`/users/${id}`);
        return response.data;
    },

    async getActive() {
        const response = await api.get<User[]>("/users/active");
        return response.data;
    },

    async getAdmins() {
        const response = await api.get<User[]>("/users/admins");
        return response.data;
    },

    async create(data: {
        username: string;
        email: string;
        password: string;
        is_admin?: number;
    }) {
        const response = await api.post<User>("/users/", data);
        return response.data;
    },

    async bulkUpload(file: File) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post("/users/bulk-upload", formData);
        return response.data;
    },

    async update(id: number, data: Partial<User>) {
        const response = await api.patch<User>(`/users/${id}`, data);
        return response.data;
    },

    async changePassword(id: number, newPassword: string) {
        const response = await api.put(`/users/${id}/password`, {
            new_password: newPassword,
        });
        return response.data;
    },

    async activate(id: number) {
        const response = await api.put<User>(`/users/${id}/activate`);
        return response.data;
    },

    async deactivate(id: number) {
        const response = await api.put<User>(`/users/${id}/deactivate`);
        return response.data;
    },

    async toggleAdmin(id: number) {
        const response = await api.put<User>(`/users/${id}/toggle-admin`);
        return response.data;
    },

    async expirePassword(id: number) {
        const response = await api.post<User>(`/users/${id}/expire-password`);
        return response.data;
    },

    async delete(id: number) {
        await api.delete(`/users/${id}`);
    },

    async countTotal() {
        const response = await api.get<{ count: number }>("/users/count/total");
        return response.data;
    },

    async countActive() {
        const response = await api.get<{ count: number }>(
            "/users/count/active",
        );
        return response.data;
    },

    async countAdmin() {
        const response = await api.get<{ count: number }>("/users/count/admin");
        return response.data;
    },
};
