

async function testSkip() {
    const fileId = "1773932278765";
    console.log(`Testing getChunkCount for ${fileId}...`);
    try {
        const col = await fetch('http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/answerai_chunks');
        const colData = await col.json();
        
        const response = await fetch(`http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/${colData.id}/get`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                where: { fileId: { "$eq": fileId } },
                include: ['metadatas']
            })
        });
        const data = await response.json();
        const count = data.ids ? data.ids.length : 0;
        console.log(`Count returned: ${count}`);
        
        if (count > 0) {
            console.log("SUCCESS: The app would SKIP embedding for this file.");
        } else {
            console.log("FAIL: The app would RE-EMBED this file!");
        }
    } catch (e) {
        console.log("Error:", e.message);
    }
}
testSkip();
