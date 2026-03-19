

async function test() {
    console.log("Testing getChunkCount...");
    try {
        const col = await fetch('http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/answerai_chunks');
        const colData = await col.json();
        
        const fileIdToTest = "1773932278765"; // From previous test
        const response = await fetch(`http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/${colData.id}/get`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                where: { fileId: { "$eq": fileIdToTest } },
                include: ['metadatas']
            })
        });
        const data = await response.json();
        console.log("Response status:", response.status);
        console.log("Returned IDs count:", data.ids ? data.ids.length : 0);
        console.log("Data:", JSON.stringify(data).substring(0, 200));
    } catch (e) {
        console.error("Error:", e.message);
    }
}
test();
test();
test();

test();
